/**
 * Identificação de pedido de substituto FORA da curadoria elegível (achado 2026-09-09,
 * pedido do fundador).
 *
 * Só é chamado depois que `SubstitutionResolutionService.resolveExplicitRequest`/`resolve`
 * já falharam contra a curadoria elegível (`findSafeCandidates`) — ou seja, o aluno não está
 * apontando pra nada que já é seguro pra ele. Existe pra distinguir dois casos que precisam
 * de tratamento diferente na Fila do Profissional:
 *
 *  1. O aluno nomeou um exercício que EXISTE no catálogo publicado, mas não é elegível pra
 *     ele (padrão de movimento errado, nível, local ou contraindicação) — vira Revisão
 *     Obrigatória, mas SEM opção de "adicionar ao catálogo" (já existe).
 *  2. O aluno nomeou um exercício que NÃO existe em lugar nenhum do catálogo — vira Revisão
 *     Obrigatória COM a opção de o time adicionar ao catálogo antes de decidir.
 *
 * Mesmo molde de segurança de `SubstitutionTargetService`/`SubstitutionResolutionService`: o
 * `matchedExerciseId` só pode ser um id que a IA RECEBEU na lista do catálogo completo —
 * nunca inventado. `requestedName`, ao contrário dos outros serviços da família, é extração
 * de texto livre (não escolha de lista fechada) — não decide nada sozinho, só alimenta o
 * match determinístico contra ids reais logo em seguida, e o texto vira `toExerciseName`
 * literal quando o exercício não existe (nunca aplicado a um protocolo sem validação).
 */
import { Injectable } from '@nestjs/common';
import type { BiologicalSex } from '@movivo/shared';
import { PinoLogger } from 'nestjs-pino';
import { z } from 'zod';

import { untrustedDataEnvelope } from '../ai-coach/context/untrusted-context';
import { LlmRouter } from '../ai-coach/llm/llm-router.service';
import type { ScrubUser } from '../ai-coach/llm/llm.types';
import type { ProtocolExerciseRef } from './substitution-target.service';

const lookupSchema = z
  .object({
    requestedName: z.string().min(1).max(120).nullable(),
    matchedExerciseId: z.string().min(1).max(100).nullable(),
  })
  .strict();

export interface IdentifyCatalogRequestParams {
  userId: string;
  operationId: string;
  user: ScrubUser;
  /** Janela recente da conversa (`ctx.volatileSuffix`), incluindo a mensagem atual do aluno. */
  recentConversation: string;
  /** Exercício-alvo já identificado, pro LLM entender o contexto da troca. */
  targetExerciseName: string;
  /** TODO o catálogo publicado (não só os elegíveis pro aluno) — único universo permitido. */
  fullCatalog: readonly ProtocolExerciseRef[];
  personaSlot: BiologicalSex | null;
}

export type IdentifyCatalogRequestResult =
  | { requestedName: null; matchedExerciseId: null }
  | { requestedName: string; matchedExerciseId: string }
  | { requestedName: string; matchedExerciseId: null };

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
export class SubstitutionCatalogLookupService {
  constructor(
    private readonly llm: LlmRouter,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(SubstitutionCatalogLookupService.name);
  }

  async identify(params: IdentifyCatalogRequestParams): Promise<IdentifyCatalogRequestResult> {
    const allowedIds = new Set(params.fullCatalog.map((ex) => ex.id));
    try {
      const result = await this.llm.complete({
        purpose: 'AI_RESPONSE',
        userId: params.userId,
        operationId: params.operationId,
        user: params.user,
        dataClass: 'HEALTH',
        temperature: 0,
        json: true,
        maxTokens: 200,
        intent: 'substitution_catalog_lookup',
        personaSlot: params.personaSlot,
        system:
          'Você lê uma conversa recente entre um aluno e o AI Coach da MOVIVO sobre trocar o ' +
          `exercício "${params.targetExerciseName}" do protocolo dele. As opções seguras já ` +
          'cadastradas pra essa troca não bateram com o que ele pediu. Responda duas coisas ' +
          'sobre a ÚLTIMA mensagem do aluno: (1) `requestedName`: ele está nomeando um ' +
          'exercício ESPECÍFICO que prefere (mesmo com palavras próprias, ex.: "supino na ' +
          'máquina", "leg press")? Extraia o nome como ele disse, sem traduzir pro nome ' +
          'técnico do catálogo. Se ele só está recusando/hesitando sem nomear nada específico ' +
          '("nenhuma dessas", "não gostei", "deixa eu pensar"), retorne null. (2) ' +
          '`matchedExerciseId`: SE `requestedName` não for null, essa é a MESMA identidade de ' +
          'exercício que alguma entrada da lista completa do catálogo recebida abaixo (mesmo ' +
          'que não seja uma opção segura pra este aluno)? "Mesma identidade" significa: é o ' +
          'mesmo movimento com outro nome/sinônimo/forma de dizer (ex.: "leg press" = "Leg ' +
          'Press 45°"), NUNCA um exercício diferente só porque parece com o mesmo grupo ' +
          'muscular, padrão de movimento ou equipamento. Duas máquinas do mesmo grupo ' +
          'muscular são exercícios DIFERENTES quando o nome/ângulo/execução diverge — ex.: ' +
          '"supino reto na máquina" (peito, deitado/reto) NÃO é a mesma entrada que "Supino ' +
          'Sentado (Máquina)" (peito, sentado) mesmo os dois sendo supino numa máquina; nesse ' +
          'caso `matchedExerciseId` é null. Na dúvida entre "é a mesma coisa" e "é parecido, ' +
          'mas diferente", responda null — um falso match aqui faz o time achar que o pedido ' +
          'já existe no catálogo quando na verdade não existe. Retorne o id exato da lista só ' +
          'quando tiver certeza de que é o mesmo exercício — não adivinhe, não invente um id. ' +
          'Se `requestedName` for null, `matchedExerciseId` também é null. Retorne somente ' +
          'JSON estrito: {"requestedName": "<texto> ou null", "matchedExerciseId": "<id da ' +
          'lista> ou null"}.',
        messages: [
          {
            role: 'user',
            content: untrustedDataEnvelope('CONVERSA_E_CATALOGO_COMPLETO', {
              conversation: params.recentConversation,
              catalog: params.fullCatalog,
            }),
          },
        ],
      });
      const parsed = lookupSchema.parse(parseJson(result.text));
      if (parsed.requestedName === null) return { requestedName: null, matchedExerciseId: null };
      if (parsed.matchedExerciseId !== null && allowedIds.has(parsed.matchedExerciseId)) {
        return { requestedName: parsed.requestedName, matchedExerciseId: parsed.matchedExerciseId };
      }
      return { requestedName: parsed.requestedName, matchedExerciseId: null };
    } catch (error) {
      this.logger.warn(
        { event: 'substitution_catalog_lookup_failed', err: String(error) },
        'identificação de pedido fora da curadoria falhou — tratado como nada específico pedido',
      );
      return { requestedName: null, matchedExerciseId: null };
    }
  }
}
