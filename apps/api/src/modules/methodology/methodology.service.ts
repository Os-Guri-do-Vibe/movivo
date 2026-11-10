/**
 * Estúdio de metodologia: rascunho → teste → publicação, por domínio.
 *
 * Regras:
 *  - os parâmetros obedecem aos limites duros do domínio (`domainParametersSchema`);
 *  - valor fora da faixa plausível só passa com justificativa escrita;
 *  - publicar exige que TODAS as tarefas de agente que usam o domínio passem nos seus casos de
 *    avaliação com o rascunho no lugar da versão publicada;
 *  - publicar substitui a versão anterior na mesma transação e grava `MethodologyPublished`.
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';

import { and, desc, eq } from 'drizzle-orm';

import {
  agentTaskLabel,
  domainParametersSchema,
  exampleParameters,
  methodologyDomainSpec,
  plausibilityIssues,
  type MethodologyDomain,
  type MethodologyParameters,
  type PlausibilityIssue,
} from '@movivo/shared';

import { AgentTaskRegistry } from '../../core/agents/agent-task-registry';
import { evalRuns, methodologyDocuments } from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { DomainEventRecorder } from '../domain-events/domain-event-recorder';
import { OutboxRelay } from '../domain-events/outbox-relay';
import { EvaluationService, type EvalRunSummary } from '../evaluation/evaluation.service';
import { readableIssues } from './methodology-issues';
import { diffMethodology, renderMethodology, type MethodologyChange } from './methodology-render';
import { PublishedMethodologyReader } from './published-methodology.reader';

export type MethodologyDocument = typeof methodologyDocuments.$inferSelect;

export interface DraftUpdate {
  parameters: MethodologyParameters;
  guidance: Record<string, string>;
  justifications: Record<string, string>;
  changeNote: string;
}

/** Falha do teste com frase já pronta para o profissional. */
class TestRunError extends Error {}

export interface TestProgress {
  state: 'IDLE' | 'RUNNING' | 'FINISHED' | 'FAILED';
  total: number;
  completed: number;
  currentTask: string | null;
  startedAt: string | null;
  outcome: TestOutcome | null;
  error: string | null;
  spentBrl: number;
  stoppedReason: string | null;
}

export interface TestEstimate {
  tasks: { taskId: string; cases: number; estimatedBrl: number | null }[];
  estimatedTotalBrl: number;
  unknownTasks: number;
  suggestedBudgetBrl: number;
  /** Modelo usado nos testes. */
  model: string | null;
}

const IDLE_PROGRESS: TestProgress = {
  state: 'IDLE',
  total: 0,
  completed: 0,
  currentTask: null,
  startedAt: null,
  outcome: null,
  error: null,
  spentBrl: 0,
  stoppedReason: null,
};

const brl = (value: number) =>
  value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
/** Sem histórico de custo de uma tarefa, assume-se este valor ao sugerir o limite. */
const UNKNOWN_TASK_BRL = 0.3;
const MIN_SUGGESTED_BUDGET_BRL = 1;

export interface TestOutcome {
  passed: boolean;
  /** Tarefas que usam o domínio e foram avaliadas. */
  evaluations: (Pick<EvalRunSummary, 'taskId' | 'passed' | 'casesTotal' | 'casesPassed'> & {
    /** O que reprovou, em português. */
    failures: string[];
  })[];
  /** Campos fora da faixa plausível sem justificativa (bloqueiam o teste). */
  unjustified: PlausibilityIssue[];
}

const OPEN_STATUSES = ['DRAFT', 'TESTING'] as const;

/** Há campo do domínio que a versão ainda não tem (acrescentado depois que ela foi criada)? */
function lacksFields(defaults: MethodologyParameters, base: MethodologyParameters): boolean {
  return Object.entries(defaults).some(([section, fields]) =>
    Object.keys(fields).some((field) => base[section]?.[field] === undefined),
  );
}

/** Completa, seção a seção, os campos que a versão de origem ainda não tinha. */
function withMissingFields(
  defaults: MethodologyParameters,
  base: MethodologyParameters,
): MethodologyParameters {
  return Object.fromEntries(
    Object.entries(defaults).map(([section, fields]) => [section, { ...fields, ...base[section] }]),
  );
}

@Injectable()
export class MethodologyService {
  private readonly logger = new Logger(MethodologyService.name);
  /** Andamento dos testes por versão. Em memória: some se a API reiniciar (o rascunho não). */
  private readonly testRuns = new Map<string, TestProgress>();
  private readonly cancelRequests = new Set<string>();
  /**
   * Tarefas que já passaram para o conteúdo ATUAL do rascunho. Testar de novo (por exemplo depois
   * de uma reprovação mais adiante, ou de um cancelamento) não paga outra vez por elas.
   */
  private readonly passedTasks = new Map<
    string,
    Map<string, { fingerprint: string; summary: EvalRunSummary }>
  >();

  constructor(
    private readonly db: TenantDatabase,
    private readonly published: PublishedMethodologyReader,
    private readonly registry: AgentTaskRegistry,
    private readonly evaluation: EvaluationService,
    private readonly events: DomainEventRecorder,
    private readonly outbox: OutboxRelay,
  ) {}

  async listDocuments(domain: MethodologyDomain): Promise<MethodologyDocument[]> {
    return this.db.runAsSystem((tx) =>
      tx
        .select()
        .from(methodologyDocuments)
        .where(eq(methodologyDocuments.domain, domain))
        .orderBy(desc(methodologyDocuments.version)),
    );
  }

  async get(id: string): Promise<MethodologyDocument> {
    const [doc] = await this.db.runAsSystem((tx) =>
      tx.select().from(methodologyDocuments).where(eq(methodologyDocuments.id, id)),
    );
    if (!doc) throw new NotFoundException('Esta versão da metodologia não foi encontrada.');
    if (!(OPEN_STATUSES as readonly string[]).includes(doc.status)) return doc;
    // Rascunho aberto antes de um campo novo existir: completa com o exemplo do campo e grava,
    // para que editar, testar e publicar enxerguem o mesmo documento.
    const defaults = exampleParameters(methodologyDomainSpec(doc.domain));
    if (!lacksFields(defaults, doc.parameters)) return doc;
    const [healed] = await this.db.runAsSystem((tx) =>
      tx
        .update(methodologyDocuments)
        .set({ parameters: withMissingFields(defaults, doc.parameters) })
        .where(eq(methodologyDocuments.id, id))
        .returning(),
    );
    return healed ?? doc;
  }

  /**
   * Abre (ou devolve) o rascunho do domínio. Parte da versão `fromVersion` (rollback), da
   * publicada, ou dos exemplos do domínio quando nada foi publicado ainda.
   */
  async openDraft(
    domain: MethodologyDomain,
    staffId: string | null,
    fromVersion?: number,
  ): Promise<MethodologyDocument> {
    return this.db.runAsSystem(async (tx) => {
      const docs = await tx
        .select()
        .from(methodologyDocuments)
        .where(eq(methodologyDocuments.domain, domain))
        .orderBy(desc(methodologyDocuments.version));
      const open = docs.find((d) => (OPEN_STATUSES as readonly string[]).includes(d.status));
      if (open && fromVersion === undefined) return open;
      if (open) {
        throw new ConflictException(
          'Já existe um rascunho aberto neste domínio. Descarte-o antes de voltar a uma versão anterior.',
        );
      }
      const base =
        fromVersion !== undefined
          ? docs.find((d) => d.version === fromVersion)
          : docs.find((d) => d.status === 'PUBLISHED');
      if (fromVersion !== undefined && !base) {
        throw new NotFoundException(`A versão ${fromVersion} não foi encontrada.`);
      }
      const spec = methodologyDomainSpec(domain);
      const [created] = await tx
        .insert(methodologyDocuments)
        .values({
          domain,
          version: (docs[0]?.version ?? 0) + 1,
          status: 'DRAFT',
          // Versões antigas podem não ter campos acrescentados depois: completa com o exemplo.
          parameters: base
            ? withMissingFields(exampleParameters(spec), base.parameters)
            : exampleParameters(spec),
          guidance: base?.guidance ?? {},
          justifications: base?.justifications ?? {},
          changeNote:
            fromVersion !== undefined ? `Rollback para a versão ${fromVersion}` : 'Rascunho',
          createdBy: staffId,
        })
        .returning();
      if (!created) throw new Error('Não foi possível abrir o rascunho.');
      return created;
    });
  }

  async updateDraft(id: string, update: DraftUpdate): Promise<MethodologyDocument> {
    const doc = await this.get(id);
    if (!(OPEN_STATUSES as readonly string[]).includes(doc.status)) {
      throw new ConflictException(
        'Só é possível editar um rascunho aberto. Esta versão já foi publicada ou descartada.',
      );
    }
    const spec = methodologyDomainSpec(doc.domain);
    const parsed = domainParametersSchema(spec).safeParse(update.parameters);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Alguns valores não puderam ser salvos. Corrija os campos abaixo e tente de novo.',
        issues: readableIssues(spec, parsed.error.issues),
      });
    }
    const guidanceKeys = new Set(spec.guidance.map((g) => g.key));
    const guidance = Object.fromEntries(
      Object.entries(update.guidance).filter(([key]) => guidanceKeys.has(key)),
    );
    const [saved] = await this.db.runAsSystem((tx) =>
      tx
        .update(methodologyDocuments)
        // Qualquer edição invalida um teste anterior: volta para DRAFT.
        .set({
          parameters: parsed.data,
          guidance,
          justifications: update.justifications,
          changeNote: update.changeNote,
          status: 'DRAFT',
          evalRunIds: [],
        })
        .where(eq(methodologyDocuments.id, id))
        .returning(),
    );
    if (!saved) throw new NotFoundException('Esta versão da metodologia não foi encontrada.');
    this.testRuns.delete(id); // qualquer edição torna o teste anterior obsoleto
    this.passedTasks.delete(id);
    return saved;
  }

  async discardDraft(id: string): Promise<void> {
    const doc = await this.get(id);
    if (!(OPEN_STATUSES as readonly string[]).includes(doc.status)) {
      throw new ConflictException(
        'Só é possível descartar um rascunho aberto. Esta versão já foi publicada ou descartada.',
      );
    }
    await this.db.runAsSystem((tx) =>
      tx
        .update(methodologyDocuments)
        .set({ status: 'DISCARDED' })
        .where(eq(methodologyDocuments.id, id)),
    );
  }

  /** Diferença do rascunho em relação à versão publicada. */
  async diff(id: string): Promise<MethodologyChange[]> {
    const doc = await this.get(id);
    const published = await this.published.publishedOf(doc.domain as MethodologyDomain);
    return diffMethodology(
      methodologyDomainSpec(doc.domain),
      published?.parameters ?? null,
      doc.parameters,
    );
  }

  /**
   * Inicia o teste do rascunho: justificativas obrigatórias e avaliação de todas as tarefas que
   * usam o domínio, com o rascunho no prompt. Aprovado → TESTING (pronto para publicar).
   * A avaliação usa modelos reais e leva minutos, então corre em segundo plano: quem chamou
   * acompanha por `testProgress`.
   */
  async startTest(id: string, staffId: string | null, budgetBrl: number): Promise<TestProgress> {
    const running = this.testRuns.get(id);
    if (running?.state === 'RUNNING') return { ...running };
    const doc = await this.get(id);
    if (!(OPEN_STATUSES as readonly string[]).includes(doc.status)) {
      throw new ConflictException(
        'Só é possível testar um rascunho aberto. Esta versão já foi publicada ou descartada.',
      );
    }
    const spec = methodologyDomainSpec(doc.domain);
    const unjustified = plausibilityIssues(spec, doc.parameters).filter(
      (issue) => !doc.justifications[issue.path]?.trim(),
    );
    if (unjustified.length > 0) {
      const blocked: TestProgress = {
        ...IDLE_PROGRESS,
        state: 'FINISHED',
        outcome: { passed: false, evaluations: [], unjustified },
      };
      this.testRuns.set(id, blocked);
      return { ...blocked };
    }

    const domain = doc.domain as MethodologyDomain;
    const taskIds = this.registry.tasksUsing(domain);
    // Antes de gastar chamadas de modelo: tarefa sem casos não tem como ser testada.
    const withoutCases = taskIds.filter((taskId) => this.registry.get(taskId).cases.length === 0);
    if (withoutCases.length > 0) {
      throw new UnprocessableEntityException(this.missingCasesMessage(spec.title, withoutCases));
    }
    const progress: TestProgress = {
      ...IDLE_PROGRESS,
      state: 'RUNNING',
      total: taskIds.length,
      currentTask: taskIds[0] ?? null,
      startedAt: new Date().toISOString(),
    };
    this.testRuns.set(id, progress);
    this.cancelRequests.delete(id);
    void this.runTest(doc, taskIds, staffId, progress, budgetBrl);
    return { ...progress };
  }

  /**
   * Mensagem para quando o teste não pode rodar por falta de casos de avaliação. A falha é de
   * cadastro (não do rascunho): o texto diz isso, lista cada tarefa uma vez, e deixa claro que as
   * alterações estão salvas e o que a equipe técnica precisa fazer.
   */
  private missingCasesMessage(domainTitle: string, taskIds: readonly string[]): string {
    const labels = [...new Set(taskIds.map(agentTaskLabel))];
    const several = labels.length > 1;
    const list = labels.map((label) => `«${label}»`).join(', ');
    return (
      `Ainda não é possível testar a metodologia de ${domainTitle} com os agentes. ` +
      `${several ? 'Estas tarefas dos agentes usam' : 'Esta tarefa dos agentes usa'} essa metodologia ` +
      `e ${several ? 'ainda não têm' : 'ainda não tem'} situações de teste cadastradas: ${list}. ` +
      'Sem elas não há como comprovar que os agentes seguem as suas alterações. ' +
      'O problema não está no seu rascunho, que continua salvo. ' +
      'Peça à equipe técnica para cadastrar essas situações de teste e tente de novo.'
    );
  }

  /** Por que a tarefa reprovou, em português: "Situação: o que se esperava". */
  private failuresOf(summary: EvalRunSummary): string[] {
    const titles = new Map(this.registry.get(summary.taskId).cases.map((c) => [c.id, c.title]));
    return summary.results
      .filter((result) => !result.pass)
      .map((result) => {
        const title = titles.get(result.caseId) ?? 'Situação de teste';
        if (result.error) {
          // Erro técnico do modelo ou da validação: o detalhe fica no log, aqui vai o resumo.
          return result.error.startsWith('saída inválida')
            ? `${title}: o modelo respondeu fora do formato esperado.`
            : `${title}: não foi possível obter a resposta do modelo.`;
        }
        const missed = result.assertions.filter((a) => !a.pass).map((a) => a.description);
        return `${title}: não atendeu${missed.length > 0 ? ` (${missed.join('; ')})` : ' ao esperado'}.`;
      });
  }

  /** Custo estimado de cada tarefa: o da última avaliação registrada (`null` se nunca foi avaliada). */
  private async estimateTasks(taskIds: readonly string[]): Promise<TestEstimate['tasks']> {
    // Só conta testes feitos no modelo barato dos testes: o histórico dos modelos de produção
    // (muito mais caros) inflaria a estimativa.
    const model = this.evaluation.panelTestModel();
    const rows = await this.db.runAsSystem((tx) =>
      tx
        .select({ taskId: evalRuns.taskId, costBrl: evalRuns.costBrl })
        .from(evalRuns)
        .where(model ? and(eq(evalRuns.vendor, 'DEEPSEEK'), eq(evalRuns.model, model)) : undefined)
        .orderBy(desc(evalRuns.finishedAt)),
    );
    const latest = new Map<string, number>();
    for (const row of rows)
      if (!latest.has(row.taskId)) latest.set(row.taskId, Number(row.costBrl));
    return taskIds.map((taskId) => ({
      taskId,
      cases: this.registry.get(taskId).cases.length,
      estimatedBrl: latest.get(taskId) ?? null,
    }));
  }

  /** Quanto o teste deve custar, ANTES de chamar qualquer modelo. */
  async estimateTest(id: string): Promise<TestEstimate> {
    const doc = await this.get(id);
    const tasks = await this.estimateTasks(this.registry.tasksUsing(doc.domain));
    const known = tasks.reduce((sum, task) => sum + (task.estimatedBrl ?? 0), 0);
    const unknownTasks = tasks.filter((task) => task.estimatedBrl === null).length;
    const margin = known * 1.5 + unknownTasks * UNKNOWN_TASK_BRL;
    return {
      tasks,
      estimatedTotalBrl: Math.round(known * 100) / 100,
      unknownTasks,
      suggestedBudgetBrl: Math.max(MIN_SUGGESTED_BUDGET_BRL, Math.ceil(margin)),
      model: this.evaluation.panelTestModel(),
    };
  }

  /** Pede para parar: vale antes da próxima tarefa (a que já está rodando termina). */
  cancelTest(id: string): TestProgress {
    if (this.testRuns.get(id)?.state === 'RUNNING') this.cancelRequests.add(id);
    return this.testProgress(id);
  }

  /** Andamento do último teste deste rascunho (`IDLE` se nenhum foi iniciado desde que a API subiu). */
  testProgress(id: string): TestProgress {
    return { ...(this.testRuns.get(id) ?? IDLE_PROGRESS) };
  }

  private async runTest(
    doc: MethodologyDocument,
    taskIds: readonly string[],
    staffId: string | null,
    progress: TestProgress,
    budgetBrl: number,
  ): Promise<void> {
    const domain = doc.domain as MethodologyDomain;
    const spec = methodologyDomainSpec(doc.domain);
    const overrideText = renderMethodology(spec, doc.version, doc.parameters, doc.guidance);
    const override = {
      [domain]: {
        text: overrideText,
        version: doc.version,
        parameters: doc.parameters,
      },
    };
    const evaluations: EvalRunSummary[] = [];
    const estimates = new Map<string, number | null>();
    const reusable = this.passedTasks.get(doc.id) ?? new Map();
    this.passedTasks.set(doc.id, reusable);
    try {
      for (const task of await this.estimateTasks(taskIds))
        estimates.set(task.taskId, task.estimatedBrl);
      // Mais baratas primeiro: se algo vai reprovar, que seja antes de pagar a tarefa cara.
      const cost = (taskId: string) => estimates.get(taskId) ?? Number.MAX_SAFE_INTEGER;
      const ordered = [...taskIds].sort((a, b) => cost(a) - cost(b));
      for (const taskId of ordered) {
        if (this.cancelRequests.delete(doc.id)) {
          throw new TestRunError(
            `Teste cancelado. Foram gastos ${brl(progress.spentBrl)} até aqui. Seu rascunho foi mantido.`,
          );
        }
        const fingerprint = createHash('sha256')
          .update(`${this.registry.get(taskId).task.promptVersion}\n${overrideText}`)
          .digest('hex');
        const cached = reusable.get(taskId);
        if (cached?.fingerprint === fingerprint) {
          evaluations.push({ ...cached.summary, costBrl: 0 }); // já passou com este conteúdo
          progress.completed += 1;
          continue;
        }
        // Não começa uma tarefa que, pela estimativa, estouraria o limite de gasto.
        const estimate = estimates.get(taskId) ?? null;
        if (estimate !== null && progress.spentBrl + estimate > budgetBrl) {
          progress.stoppedReason = `Parei antes de «${agentTaskLabel(taskId)}» para não passar do limite de ${brl(budgetBrl)} (estimativa dela: ${brl(estimate)}).`;
          break;
        }
        progress.currentTask = taskId;
        try {
          const summary = await this.evaluation.evaluate(taskId, {
            methodologyOverride: override,
            routeOverride: this.evaluation.panelTestRoute(taskId),
            requestedBy: staffId,
          });
          evaluations.push(summary);
          progress.spentBrl += summary.costBrl;
          if (summary.passed) reusable.set(taskId, { fingerprint, summary });
        } catch (error) {
          this.logger.error(
            `teste da metodologia ${domain}: falha na tarefa ${taskId}`,
            error instanceof Error ? error.stack : String(error),
          );
          throw new TestRunError(
            `O teste parou em «${agentTaskLabel(taskId)}» porque o modelo de IA não respondeu como esperado. Seu rascunho foi mantido; tente testar de novo em instantes. Se repetir, avise a equipe técnica.`,
          );
        }
        progress.completed += 1;
        // Reprovou: o rascunho não pode ser publicado de qualquer forma, então não gasta com o resto.
        if (!evaluations[evaluations.length - 1]?.passed) {
          progress.stoppedReason = `O teste parou em «${agentTaskLabel(taskId)}», que reprovou. Não rodei as outras tarefas para não gastar à toa (${brl(progress.spentBrl)} usados até aqui).`;
          break;
        }
        if (progress.spentBrl >= budgetBrl && progress.completed < taskIds.length) {
          progress.stoppedReason = `Parei ao atingir o limite de ${brl(budgetBrl)}.`;
          break;
        }
      }
      if (this.testRuns.get(doc.id) !== progress) return; // rascunho editado: teste obsoleto
      // Parou antes de avaliar tudo (reprovação ou limite de gasto): não vale como aprovado.
      const passed = evaluations.every((e) => e.passed) && progress.completed === taskIds.length;
      await this.db.runAsSystem((tx) =>
        tx
          .update(methodologyDocuments)
          .set({
            status: passed ? 'TESTING' : 'DRAFT',
            evalRunIds: evaluations.map((e) => e.evalRunId),
          })
          .where(eq(methodologyDocuments.id, doc.id)),
      );
      progress.outcome = {
        passed,
        // O painel só precisa do resumo; os resultados completos ficam em `eval_runs`.
        evaluations: evaluations.map((summary) => ({
          taskId: summary.taskId,
          passed: summary.passed,
          casesTotal: summary.casesTotal,
          casesPassed: summary.casesPassed,
          failures: this.failuresOf(summary),
        })),
        unjustified: [],
      };
      progress.state = 'FINISHED';
    } catch (error) {
      if (!(error instanceof TestRunError)) {
        this.logger.error(
          `teste da metodologia ${domain}: erro inesperado`,
          error instanceof Error ? error.stack : String(error),
        );
      }
      progress.error =
        error instanceof TestRunError
          ? error.message
          : 'Não foi possível concluir o teste. Seu rascunho foi mantido; tente de novo em instantes.';
      progress.state = 'FAILED';
    } finally {
      progress.currentTask = null;
    }
  }

  /** Publica um rascunho aprovado nos testes, substituindo a versão anterior. */
  async publish(id: string, staffId: string): Promise<MethodologyDocument> {
    const published = await this.db.runAsSystem(async (tx) => {
      const [doc] = await tx
        .select()
        .from(methodologyDocuments)
        .where(eq(methodologyDocuments.id, id));
      if (!doc) throw new NotFoundException('Esta versão da metodologia não foi encontrada.');
      if (doc.status !== 'TESTING') {
        // Exceção deliberada: a PRIMEIRA versão de um domínio pode ser publicada sem o teste com
        // os agentes (decisão do fundador). Daí em diante, toda mudança passa pelo teste.
        const [inForce] =
          doc.status === 'DRAFT'
            ? await tx
                .select({ id: methodologyDocuments.id })
                .from(methodologyDocuments)
                .where(
                  and(
                    eq(methodologyDocuments.domain, doc.domain),
                    eq(methodologyDocuments.status, 'PUBLISHED'),
                  ),
                )
                .limit(1)
            : [undefined];
        if (doc.status !== 'DRAFT' || inForce) {
          throw new ConflictException(
            'Esta versão ainda não passou nos testes. Rode o teste com os agentes antes de publicar.',
          );
        }
        const unjustified = plausibilityIssues(
          methodologyDomainSpec(doc.domain),
          doc.parameters,
        ).filter((issue) => !doc.justifications[issue.path]?.trim());
        if (unjustified.length > 0) {
          throw new UnprocessableEntityException(
            'Há valores fora da faixa usual sem justificativa. Explique cada um antes de publicar.',
          );
        }
      }
      await tx
        .update(methodologyDocuments)
        .set({ status: 'SUPERSEDED' })
        .where(
          and(
            eq(methodologyDocuments.domain, doc.domain),
            eq(methodologyDocuments.status, 'PUBLISHED'),
          ),
        );
      const [saved] = await tx
        .update(methodologyDocuments)
        .set({ status: 'PUBLISHED', publishedBy: staffId, publishedAt: new Date() })
        .where(eq(methodologyDocuments.id, id))
        .returning();
      if (!saved) throw new Error('Não foi possível publicar a versão.');
      await this.events.record(tx, {
        userId: null,
        type: 'MethodologyPublished',
        payload: { domain: saved.domain, version: saved.version, documentId: saved.id },
      });
      return saved;
    });
    this.published.invalidate();
    await this.outbox.flushSoon();
    return published;
  }
}
