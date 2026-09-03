/**
 * Identificação do exercício-alvo de uma substituição (achado 2026-09-02).
 *
 * Substitui o antigo `findExerciseByMention` (match de substring): a IA lê a CONVERSA
 * recente + a lista de exercícios do protocolo ATIVO dele e decide qual (se algum) ele quer
 * trocar — inclusive quando ele não usa a palavra "trocar" ("me sinto inseguro e fraco nesse
 * exercício"). Mesmo molde de `EvidenceGroundingService`: JSON estrito, temperatura 0, e o
 * modelo só pode devolver um id da lista que RECEBEU — nunca um id livre. Um id fora da lista
 * (alucinação) é tratado como "não identificado", nunca aceito.
 *
 * Achado 2026-09-02 (reproduzido ao vivo): a primeira versão recebia só a ÚLTIMA mensagem do
 * aluno, isolada. Funcionava no primeiro turno ("aquele levantamento terra romeno... me deixa
 * inseguro"), mas falhava em qualquer turno de continuação — "é insegurança mesmo, sem dor" não
 * menciona exercício NENHUM fora do contexto da mensagem anterior. `identified: false` nesse
 * caso empurrava o worker pro fallback SEM `allowedExercises`, e a IA (que via a conversa
 * inteira do outro lado) seguia em frente e verbalizava a troca de qualquer jeito — sem
 * NENHUMA restrição de vocabulário. Corrigido dando à identificação a mesma janela de conversa
 * recente que o resto do fluxo já usa (`ctx.volatileSuffix`), não só a última mensagem.
 */
import { Injectable } from '@nestjs/common';
import type { BiologicalSex } from '@movivo/shared';
import { PinoLogger } from 'nestjs-pino';
import { z } from 'zod';

import { untrustedDataEnvelope } from '../ai-coach/context/untrusted-context';
import { LlmRouter } from '../ai-coach/llm/llm-router.service';
import type { ScrubUser } from '../ai-coach/llm/llm.types';

const targetSchema = z
  .object({
    exerciseId: z.string().min(1).max(100).nullable(),
  })
  .strict();

export interface ProtocolExerciseRef {
  readonly id: string;
  readonly name: string;
}

export interface IdentifyTargetRequest {
  userId: string;
  operationId: string;
  user: ScrubUser;
  /** Janela recente da conversa (`ctx.volatileSuffix`), incluindo a mensagem atual do aluno —
   * não só a última mensagem isolada, para turnos de continuação fazerem sentido. */
  recentConversation: string;
  /** Exercícios do protocolo ATIVO do aluno — só entre eles a IA pode identificar o alvo. */
  protocolExercises: readonly ProtocolExerciseRef[];
  personaSlot: BiologicalSex | null;
}

export type IdentifyTargetResult = { identified: true; exerciseId: string } | { identified: false };

function parseJson(text: string): unknown {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/iu, '')
    .replace(/\s*```$/u, '');
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first < 0 || last <= first) throw new Error('JSON ausente');
  return JSON.parse(trimmed.slice(first, last + 1));
}

@Injectable()
export class SubstitutionTargetService {
  constructor(
    private readonly llm: LlmRouter,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(SubstitutionTargetService.name);
  }

  async identify(request: IdentifyTargetRequest): Promise<IdentifyTargetResult> {
    if (request.protocolExercises.length === 0) return { identified: false };
    const allowedIds = new Set(request.protocolExercises.map((ex) => ex.id));

    try {
      const result = await this.llm.complete({
        purpose: 'AI_RESPONSE',
        userId: request.userId,
        operationId: request.operationId,
        user: request.user,
        dataClass: 'HEALTH',
        temperature: 0,
        json: true,
        maxTokens: 160,
        // `ai_jobs.intent` é `varchar(30)` — achado 2026-09-02 (reproduzido ao vivo): um
        // valor mais longo aqui não falha a chamada em si, mas quebra a GRAVAÇÃO da
        // auditoria de falha (`LlmRouter.recordFailure`), que mascara o erro real do
        // provedor com um erro de banco. Mantido ≤30 chars de propósito.
        intent: 'substitution_target_match',
        personaSlot: request.personaSlot,
        system:
          'Você identifica qual exercício do protocolo de treino do aluno ele quer trocar ou ' +
          'está insatisfeito com — a partir de uma conversa recente de WhatsApp com o AI Coach ' +
          'da MOVIVO. O aluno pode não usar a palavra "trocar": insegurança, medo, desconforto, ' +
          '"não gosto desse", dor leve não emergencial ao fazer um exercício específico e ' +
          'pedido direto de substituição contam igualmente. A ÚLTIMA mensagem do aluno pode não ' +
          'nomear o exercício sozinha (ex.: uma resposta de continuação como "é insegurança ' +
          'mesmo, sem dor") — use as mensagens ANTERIORES da mesma conversa pra entender a que ' +
          'exercício ele se refere. Se, mesmo considerando a conversa inteira, não der pra ' +
          'apontar com confiança para UM exercício da lista recebida, responda null — não ' +
          'adivinhe. Retorne somente JSON estrito: {"exerciseId": "<id da lista> ou null"}. O ' +
          'id retornado TEM que ser exatamente um dos ids recebidos na lista.',
        messages: [
          {
            role: 'user',
            content: untrustedDataEnvelope('CONVERSA_E_EXERCICIOS_DO_PROTOCOLO', {
              conversation: request.recentConversation,
              exercises: request.protocolExercises,
            }),
          },
        ],
      });
      const parsed = targetSchema.parse(parseJson(result.text));
      if (parsed.exerciseId === null || !allowedIds.has(parsed.exerciseId)) {
        return { identified: false };
      }
      return { identified: true, exerciseId: parsed.exerciseId };
    } catch (error) {
      this.logger.warn(
        { event: 'substitution_target_identification_failed', err: String(error) },
        'identificação do exercício-alvo falhou — fallback honesto',
      );
      return { identified: false };
    }
  }
}
