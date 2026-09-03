/**
 * Resolução da confirmação de uma substituição de exercício (achado 2026-09-02).
 *
 * Turno 2 do fluxo: dado o HISTÓRICO recente da conversa (que já pode conter uma oferta
 * anterior de candidatos, feita pela própria MOVI, e a resposta do aluno), decide se o aluno
 * acabou de confirmar UM candidato específico. Não há estado guardado em banco/Redis do que
 * foi oferecido — a conversa em si já carrega essa informação, e é lida de novo aqui a cada
 * turno (mesmo raciocínio de "nunca confiar em cálculo antigo" do resto do fluxo).
 *
 * Achado 2026-09-02 (reproduzido ao vivo): a primeira versão pedia pra IA EXTRAIR o nome
 * exato do exercício escolhido a partir do texto livre da conversa — e falhava sempre, porque
 * o turno de oferta verbaliza o candidato de forma humanizada ("supino reto com halter"), não
 * com o nome literal do catálogo ("Supino Reto (Halter)"). Comparação exata contra o texto
 * livre nunca batia. A correção: em vez de EXTRAIR um nome do texto, a IA ESCOLHE (ou não)
 * um item de uma lista FECHADA — os candidatos seguros já recomputados por quem chama —
 * mesmo padrão do `SubstitutionTargetService` (a IA só pode devolver um id que RECEBEU).
 */
import { Injectable } from '@nestjs/common';
import type { BiologicalSex } from '@movivo/shared';
import { PinoLogger } from 'nestjs-pino';
import { z } from 'zod';

import { untrustedDataEnvelope } from '../ai-coach/context/untrusted-context';
import { LlmRouter } from '../ai-coach/llm/llm-router.service';
import type { ScrubUser } from '../ai-coach/llm/llm.types';
import type { ProtocolExerciseRef } from './substitution-target.service';

const resolutionSchema = z
  .object({
    chosenExerciseId: z.string().min(1).max(100).nullable(),
  })
  .strict();

export interface ResolveChoiceRequest {
  userId: string;
  operationId: string;
  user: ScrubUser;
  /** Janela recente da conversa (`ctx.volatileSuffix`), incluindo a mensagem atual do aluno. */
  recentConversation: string;
  /** Exercício-alvo já identificado (para a IA entender o contexto da troca). */
  targetExerciseName: string;
  /** Candidatos seguros JÁ recomputados — a única coisa que a IA pode escolher. */
  candidates: readonly ProtocolExerciseRef[];
  personaSlot: BiologicalSex | null;
}

export type ResolveChoiceResult =
  { resolved: true; chosenExerciseId: string } | { resolved: false };

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
export class SubstitutionResolutionService {
  constructor(
    private readonly llm: LlmRouter,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(SubstitutionResolutionService.name);
  }

  async resolve(request: ResolveChoiceRequest): Promise<ResolveChoiceResult> {
    if (request.candidates.length === 0) return { resolved: false };
    const allowedIds = new Set(request.candidates.map((c) => c.id));

    try {
      const result = await this.llm.complete({
        purpose: 'AI_RESPONSE',
        userId: request.userId,
        operationId: request.operationId,
        user: request.user,
        dataClass: 'HEALTH',
        temperature: 0,
        json: true,
        maxTokens: 120,
        intent: 'substitution_choice_resolution',
        personaSlot: request.personaSlot,
        system:
          'Você lê uma conversa recente entre um aluno e o AI Coach da MOVIVO, na qual o Coach ' +
          `já ofereceu opções para substituir o exercício "${request.targetExerciseName}" do ` +
          'protocolo do aluno. Decida se a ÚLTIMA mensagem do aluno confirma UM dos candidatos ' +
          'recebidos abaixo especificamente (ele pode se referir por nome, apelido, posição na ' +
          'lista ou característica citada por você anteriormente — use a conversa pra entender ' +
          'a quem ele se refere). Uma confirmação vaga sem apontar pra nenhum candidato em ' +
          'especial ("ok", "beleza", "pode ser") NÃO conta — retorne chosenExerciseId:null. Se ' +
          'não há confirmação na última mensagem, também retorne null. Retorne somente JSON ' +
          'estrito: {"chosenExerciseId": "<id de um dos candidatos abaixo> ou null"}. O id TEM ' +
          'que ser exatamente um dos ids recebidos.',
        messages: [
          {
            role: 'user',
            content: untrustedDataEnvelope('CONVERSA_E_CANDIDATOS', {
              conversation: request.recentConversation,
              candidates: request.candidates,
            }),
          },
        ],
      });
      const parsed = resolutionSchema.parse(parseJson(result.text));
      if (parsed.chosenExerciseId === null || !allowedIds.has(parsed.chosenExerciseId)) {
        return { resolved: false };
      }
      return { resolved: true, chosenExerciseId: parsed.chosenExerciseId };
    } catch (error) {
      this.logger.warn(
        { event: 'substitution_choice_resolution_failed', err: String(error) },
        'resolução da confirmação de troca falhou — segue como não resolvida',
      );
      return { resolved: false };
    }
  }
}
