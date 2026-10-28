/**
 * AgentRunner — executa uma tarefa de agente de ponta a ponta.
 *
 * Monta o prompt em camadas (o código monta, o modelo não busca contexto):
 *   system  = constituição + papel + tarefa + metodologia publicada + schema de saída
 *   usuário = <dados> fatias do Estado do Aluno + entrada da tarefa </dados>
 * Chama o gateway no tier da tarefa, valida a saída contra o schema e os validadores
 * determinísticos e, havendo violações, devolve ao modelo a lista exata do que corrigir — até
 * `maxCorrectionRounds`. A saída aprovada é sempre uma PROPOSTA: quem executa é o motor de
 * políticas, fora daqui.
 */
import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import type { GatewayMessage, TierRoute } from '../ai/ai.types';
import { ModelGateway } from '../ai/model-gateway';
import type { ScrubUser } from '../ai/pii-scrubber';
import type { AgentContextSources, MethodologyContext } from './agent-context';
import type { AgentTask, Violation } from './agent-task';
import { CONSTITUTION } from './constitution';

export interface AgentRunOptions {
  /** Titular sobre quem é a tarefa (nulo em tarefas sem aluno). */
  userId: string | null;
  scrubUser?: ScrubUser;
  sources: AgentContextSources;
  /** Só avaliação: força o modelo (comparação antes de trocar a configuração do tier). */
  routeOverride?: TierRoute;
}

export interface AgentRunResult<O> {
  output: O;
  /** Uma por chamada ao modelo (inclui as rodadas de correção). */
  modelRunIds: string[];
  correctionRounds: number;
  stateVersion: number;
  methodologyVersions: MethodologyContext['versions'];
  costBrl: number;
}

/** A tarefa não produziu saída válida dentro das rodadas de correção. */
export class AgentTaskError extends Error {
  constructor(
    readonly taskId: string,
    readonly violations: Violation[],
    readonly modelRunIds: string[],
  ) {
    super(`${taskId}: saída inválida após as rodadas de correção`);
    this.name = 'AgentTaskError';
  }
}

/** Extrai o JSON da resposta (tolera cercas de código que alguns modelos insistem em usar). */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  const body = fenced?.[1] ?? trimmed;
  const start = body.search(/[[{]/);
  if (start < 0) throw new SyntaxError('resposta sem JSON');
  return JSON.parse(body.slice(start));
}

function zodViolations(error: z.ZodError): Violation[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.') || '(raiz)',
    message: issue.message,
  }));
}

export function composeSystem(task: AgentTask<unknown, unknown>, methodology: string): string {
  const schema = JSON.stringify(z.toJSONSchema(task.output, { unrepresentable: 'any' }));
  return [
    CONSTITUTION,
    `# Seu papel\n${task.role}`,
    `# Tarefa\n${task.instructions}`,
    methodology ? `# Metodologia MOVIVO (publicada)\n${methodology}` : '',
    `# Schema da resposta (JSON Schema)\n${schema}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

function correctionMessage(violations: Violation[]): string {
  const list = violations.map((v) => `- ${v.path}: ${v.message}`).join('\n');
  return `Sua resposta anterior tem problemas que impedem o uso:\n${list}\n\nCorrija TODOS e devolva o JSON completo outra vez, seguindo o schema.`;
}

@Injectable()
export class AgentRunner {
  constructor(private readonly gateway: ModelGateway) {}

  async run<I, O>(
    task: AgentTask<I, O>,
    rawInput: I,
    options: AgentRunOptions,
  ): Promise<AgentRunResult<O>> {
    const input = task.input.parse(rawInput);
    const [methodology, state] = await Promise.all([
      options.sources.methodology(task.methodology),
      options.sources.state(task.state),
    ]);
    const system = composeSystem(task as AgentTask<unknown, unknown>, methodology.text);
    const messages: GatewayMessage[] = [
      {
        role: 'user',
        content: `<dados>\n${JSON.stringify({ estadoDoAluno: state.slices, entrada: input })}\n</dados>`,
      },
    ];

    const modelRunIds: string[] = [];
    let costBrl = 0;
    let violations: Violation[] = [];
    for (let round = 0; round <= task.maxCorrectionRounds; round += 1) {
      const result = await this.gateway.complete({
        tier: task.tier,
        taskId: task.id,
        promptVersion: task.promptVersion,
        userId: options.userId,
        scrubUser: options.scrubUser,
        system,
        messages,
        json: true,
        routeOverride: options.routeOverride,
      });
      modelRunIds.push(result.modelRunId);
      costBrl += result.costBrl;

      violations = await this.validate(
        task,
        input,
        result.text,
        state.slices,
        methodology.parameters ?? {},
      );
      if (violations.length === 0) {
        return {
          output: task.output.parse(extractJson(result.text)),
          modelRunIds,
          correctionRounds: round,
          stateVersion: state.version,
          methodologyVersions: methodology.versions,
          costBrl,
        };
      }
      messages.push({ role: 'assistant', content: result.text });
      messages.push({ role: 'user', content: correctionMessage(violations) });
    }
    throw new AgentTaskError(task.id, violations, modelRunIds);
  }

  private async validate<I, O>(
    task: AgentTask<I, O>,
    input: I,
    text: string,
    state: Record<string, unknown>,
    methodology: NonNullable<MethodologyContext['parameters']>,
  ): Promise<Violation[]> {
    let raw: unknown;
    try {
      raw = extractJson(text);
    } catch {
      return [{ path: '(raiz)', message: 'a resposta não é um JSON válido' }];
    }
    const parsed = task.output.safeParse(raw);
    if (!parsed.success) return zodViolations(parsed.error);
    const found: Violation[] = [];
    for (const validator of task.validators) {
      found.push(...(await validator(input, parsed.data, { state, methodology })));
    }
    return found;
  }
}
