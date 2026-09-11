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

/**
 * Achado 2026-09-08 (bug reproduzido ao vivo pelo fundador): `resolve()` (turno 2, contra a
 * lista JÁ oferecida) só sabia dizer "escolheu um destes" ou "não escolheu" — sem distinguir
 * "ainda não decidiu" (deve reofertar/esclarecer) de "recusou TODAS as opções e insiste em
 * outro exercício que não está na base" (deve parar de reofertar e ser honesto). Sem essa
 * distinção, o worker caía sempre no mesmo caminho generativo — e a IA, livre pra formular a
 * própria frase, às vezes "prometia" registrar/encaminhar pro profissional sem que NENHUM
 * código realmente fizesse isso (`ai-response.worker.ts` só cria o alerta real quando
 * `humanReview: true`, e esse branch nunca setava). `rejectedAll` fecha esse buraco: quando
 * verdadeiro, o worker manda uma mensagem honesta FIXA (não gerada) com `humanReview: true`,
 * garantindo o alerta de verdade que a resposta da IA só afirmava.
 */
const resolutionWithRejectionSchema = z
  .object({
    chosenExerciseId: z.string().min(1).max(100).nullable(),
    rejectedAll: z.boolean(),
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
  | { resolved: true; chosenExerciseId: string }
  | { resolved: false };

/** `resolve()` only — turno 2 distingue "ainda não decidiu" de "recusou tudo". */
export type ResolveConfirmationResult =
  | { resolved: true; chosenExerciseId: string }
  | { resolved: false; rejectedAll: boolean };

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

  async resolve(request: ResolveChoiceRequest): Promise<ResolveConfirmationResult> {
    if (request.candidates.length === 0) return { resolved: false, rejectedAll: false };
    const allowedIds = new Set(request.candidates.map((c) => c.id));
    const system =
      'Você lê uma conversa recente entre um aluno e o AI Coach da MOVIVO, na qual o Coach ' +
      `já ofereceu opções para substituir o exercício "${request.targetExerciseName}" do ` +
      'protocolo do aluno. Decida duas coisas sobre a ÚLTIMA mensagem do aluno: ' +
      '(1) `chosenExerciseId`: ela confirma UM dos candidatos recebidos abaixo especificamente ' +
      '(ele pode se referir por nome, apelido, posição na lista ou característica citada por ' +
      'você anteriormente)? Uma confirmação vaga sem apontar pra nenhum candidato em especial ' +
      '("ok", "beleza", "pode ser") NÃO conta — null. Sem confirmação nenhuma, também null. ' +
      '(2) `rejectedAll`: ela recusa EXPLICITAMENTE todos os candidatos oferecidos E insiste ' +
      'num exercício específico diferente deles (ex.: "nenhuma dessas, quero X mesmo", "não é ' +
      'isso, prefiro Y")? true só nesse caso claro de recusa + insistência noutra coisa — ' +
      'false pra qualquer dúvida, pergunta, ou só "não gostei"/"não sei" sem nomear outra ' +
      'preferência (isso é indecisão, não recusa). Retorne somente JSON estrito: ' +
      '{"chosenExerciseId": "<id de um dos candidatos abaixo> ou null", "rejectedAll": ' +
      'true ou false}. O id TEM que ser exatamente um dos ids recebidos.';

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
        system,
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
      const parsed = resolutionWithRejectionSchema.parse(parseJson(result.text));
      if (parsed.chosenExerciseId !== null && allowedIds.has(parsed.chosenExerciseId)) {
        return { resolved: true, chosenExerciseId: parsed.chosenExerciseId };
      }
      return { resolved: false, rejectedAll: parsed.rejectedAll };
    } catch (error) {
      this.logger.warn(
        { event: 'substitution_choice_resolution_failed', err: String(error) },
        'resolução da troca falhou — segue como não resolvida',
      );
      return { resolved: false, rejectedAll: false };
    }
  }

  /**
   * Achado 2026-09-08 (pedido do fundador, reproduzido ao vivo): "posso trocar [X] por
   * esteira normal?" é ao mesmo tempo o pedido de troca E a escolha do substituto — mas
   * `findSafeCandidates` só expõe até `MAX_SUBSTITUTION_CANDIDATES` (a lista curada `substitutes`
   * enche o teto primeiro), então "esteira" podia nunca aparecer entre as opções OFERECIDAS
   * mesmo sendo um substituto seguro do mesmo padrão — e a resposta do LLM, ao citar
   * "esteira" de volta pro aluno, virava `EXERCISE_NOT_ALLOWED` no `ValidationService`
   * (nome de catálogo fora do `allowedExercises` daquele turno) e caía no fallback padrão,
   * SEM registrar nada na fila de substituição.
   *
   * Chamado ANTES do teto de exibição, contra o universo COMPLETO de candidatos seguros
   * (`findSafeCandidates(..., catalog.length)`), pra pedidos explícitos nunca dependerem da
   * ordem/teto da lista oferecida. Só aceita nome/apelido EXPLÍCITO — nunca referência vaga
   * ou posicional (isso continua sendo papel exclusivo de `resolve`, turno 2, contra a lista
   * efetivamente já oferecida).
   */
  async resolveExplicitRequest(request: ResolveChoiceRequest): Promise<ResolveChoiceResult> {
    return this.runResolution(
      request,
      'substitution_explicit_request',
      'substitution_explicit_request_failed',
      'Você lê uma conversa recente entre um aluno e o AI Coach da MOVIVO. O aluno pediu para ' +
        `trocar o exercício "${request.targetExerciseName}" do protocolo dele e pode ter citado, ` +
        'na própria mensagem, o nome de um substituto específico que prefere — mesmo sem o Coach ' +
        'ter oferecido opções ainda. Verifique se a ÚLTIMA mensagem do aluno NOMEIA explicitamente ' +
        '(por nome ou apelido claro) um dos candidatos seguros recebidos abaixo. Referências vagas ' +
        'ou posicionais ("pode ser esse", "a segunda opção", "qualquer um") NÃO contam — retorne ' +
        'chosenExerciseId:null nesses casos, mesmo que pareçam uma confirmação. Retorne somente ' +
        'JSON estrito: {"chosenExerciseId": "<id de um dos candidatos abaixo> ou null"}. O id TEM ' +
        'que ser exatamente um dos ids recebidos.',
    );
  }

  private async runResolution(
    request: ResolveChoiceRequest,
    intent: string,
    failureEvent: string,
    system: string,
  ): Promise<ResolveChoiceResult> {
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
        intent,
        personaSlot: request.personaSlot,
        system,
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
        { event: failureEvent, err: String(error) },
        'resolução da troca falhou — segue como não resolvida',
      );
      return { resolved: false };
    }
  }
}
