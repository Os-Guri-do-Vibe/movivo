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
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';

import {
  domainParametersSchema,
  exampleParameters,
  methodologyDomainSpec,
  plausibilityIssues,
  type MethodologyDomain,
  type MethodologyParameters,
  type PlausibilityIssue,
} from '@movivo/shared';

import { AgentTaskRegistry } from '../../core/agents/agent-task-registry';
import { methodologyDocuments } from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { DomainEventRecorder } from '../domain-events/domain-event-recorder';
import { OutboxRelay } from '../domain-events/outbox-relay';
import { EvaluationService, type EvalRunSummary } from '../evaluation/evaluation.service';
import { diffMethodology, renderMethodology, type MethodologyChange } from './methodology-render';
import { PublishedMethodologyReader } from './published-methodology.reader';

export type MethodologyDocument = typeof methodologyDocuments.$inferSelect;

export interface DraftUpdate {
  parameters: MethodologyParameters;
  guidance: Record<string, string>;
  justifications: Record<string, string>;
  changeNote: string;
}

export interface TestOutcome {
  passed: boolean;
  /** Tarefas que usam o domínio e foram avaliadas. */
  evaluations: EvalRunSummary[];
  /** Campos fora da faixa plausível sem justificativa (bloqueiam o teste). */
  unjustified: PlausibilityIssue[];
}

const OPEN_STATUSES = ['DRAFT', 'TESTING'] as const;

@Injectable()
export class MethodologyService {
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
    if (!doc) throw new NotFoundException('versão de metodologia não encontrada');
    return doc;
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
        throw new ConflictException('já existe um rascunho aberto; descarte-o antes do rollback');
      }
      const base =
        fromVersion !== undefined
          ? docs.find((d) => d.version === fromVersion)
          : docs.find((d) => d.status === 'PUBLISHED');
      if (fromVersion !== undefined && !base) {
        throw new NotFoundException(`versão ${fromVersion} não encontrada`);
      }
      const spec = methodologyDomainSpec(domain);
      const [created] = await tx
        .insert(methodologyDocuments)
        .values({
          domain,
          version: (docs[0]?.version ?? 0) + 1,
          status: 'DRAFT',
          parameters: base?.parameters ?? exampleParameters(spec),
          guidance: base?.guidance ?? {},
          justifications: base?.justifications ?? {},
          changeNote:
            fromVersion !== undefined ? `Rollback para a versão ${fromVersion}` : 'Rascunho',
          createdBy: staffId,
        })
        .returning();
      if (!created) throw new Error('falha ao abrir rascunho');
      return created;
    });
  }

  async updateDraft(id: string, update: DraftUpdate): Promise<MethodologyDocument> {
    const doc = await this.get(id);
    if (!(OPEN_STATUSES as readonly string[]).includes(doc.status)) {
      throw new ConflictException('só um rascunho aberto pode ser editado');
    }
    const spec = methodologyDomainSpec(doc.domain);
    const parsed = domainParametersSchema(spec).safeParse(update.parameters);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'parâmetros fora dos limites do domínio',
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
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
    if (!saved) throw new NotFoundException('versão de metodologia não encontrada');
    return saved;
  }

  async discardDraft(id: string): Promise<void> {
    const doc = await this.get(id);
    if (!(OPEN_STATUSES as readonly string[]).includes(doc.status)) {
      throw new ConflictException('só um rascunho aberto pode ser descartado');
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
   * Testa o rascunho: justificativas obrigatórias e avaliação de todas as tarefas que usam o
   * domínio, com o rascunho no prompt. Aprovado → TESTING (pronto para publicar).
   */
  async test(id: string, staffId: string | null): Promise<TestOutcome> {
    const doc = await this.get(id);
    if (!(OPEN_STATUSES as readonly string[]).includes(doc.status)) {
      throw new ConflictException('só um rascunho aberto pode ser testado');
    }
    const spec = methodologyDomainSpec(doc.domain);
    const unjustified = plausibilityIssues(spec, doc.parameters).filter(
      (issue) => !doc.justifications[issue.path]?.trim(),
    );
    if (unjustified.length > 0) return { passed: false, evaluations: [], unjustified };

    const domain = doc.domain as MethodologyDomain;
    const override = {
      [domain]: {
        text: renderMethodology(spec, doc.version, doc.parameters, doc.guidance),
        version: doc.version,
      },
    };
    const evaluations: EvalRunSummary[] = [];
    for (const taskId of this.registry.tasksUsing(domain)) {
      evaluations.push(
        await this.evaluation.evaluate(taskId, {
          methodologyOverride: override,
          requestedBy: staffId,
        }),
      );
    }
    const passed = evaluations.every((e) => e.passed);
    await this.db.runAsSystem((tx) =>
      tx
        .update(methodologyDocuments)
        .set({
          status: passed ? 'TESTING' : 'DRAFT',
          evalRunIds: evaluations.map((e) => e.evalRunId),
        })
        .where(eq(methodologyDocuments.id, id)),
    );
    return { passed, evaluations, unjustified: [] };
  }

  /** Publica um rascunho aprovado nos testes, substituindo a versão anterior. */
  async publish(id: string, staffId: string): Promise<MethodologyDocument> {
    const published = await this.db.runAsSystem(async (tx) => {
      const [doc] = await tx
        .select()
        .from(methodologyDocuments)
        .where(eq(methodologyDocuments.id, id));
      if (!doc) throw new NotFoundException('versão de metodologia não encontrada');
      if (doc.status !== 'TESTING') {
        throw new ConflictException('a versão precisa passar nos testes antes de ser publicada');
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
      if (!saved) throw new Error('falha ao publicar');
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
