/**
 * IntentClassifier (US-3.4) — roteia a mensagem à intenção certa a custo/latência mínimos.
 *
 * Três etapas: (0) guardrail clínico regex ANTES de qualquer custo de IA; (1) embedding-kNN
 * contra `intent_examples` quando a confiança é alta; (2) fallback GPT-4.1-nano só nos casos
 * ambíguos. A saída (`IntentResult`) diz ao `AIResponseWorker` (US-3.5) qual prompt usar e se
 * dispara handoff de segurança clínica.
 */
import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import { LlmRouter } from '../llm/llm-router.service';
import type { ScrubUser } from '../llm/llm.types';
import { scrubPII } from '../llm/pii-scrubber';
import { EMBEDDING_PORT, type EmbeddingPort } from '../rag/embedding.port';
import { clinicalGuardrail } from './clinical-guardrail';
import { IntentRepository } from './intent.repository';
import { type Intent, type IntentResult, INTENTS, isIntent } from './intent.types';
import { wrapUserMessage } from '../../protocol/validation/prompt-injection';

export interface ClassifyInput {
  userId: string;
  user: ScrubUser;
  message: string;
}

/** ponytail: knob de confiança do kNN — calibrar quando o embedding real (não-fake) entrar. */
const KNN_MIN_CONFIDENCE = 0.6;

@Injectable()
export class IntentClassifier {
  constructor(
    @Inject(EMBEDDING_PORT) private readonly embedding: EmbeddingPort,
    private readonly repo: IntentRepository,
    private readonly llm: LlmRouter,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(IntentClassifier.name);
  }

  async classify(input: ClassifyInput): Promise<IntentResult> {
    // Etapa 0 — guardrail clínico ANTES de pagar embedding/LLM.
    const guard = clinicalGuardrail(input.message);
    if (guard) {
      return {
        intent: 'FORA_DE_ESCOPO',
        confidence: 1,
        stage: 'GUARDRAIL',
        safetyHandoff: guard === 'SAFETY',
      };
    }

    // Etapa 1 — embedding-kNN. Best-effort: achado 2026-09-02 (reproduzido ao vivo) — o
    // provedor de embedding (OpenAI) devolvendo 429 aqui derrubava a chamada inteira sem
    // try/catch, matando `AIResponseWorker.process()` DEPOIS de já ter drenado o lote da
    // mensagem do aluno. A retry do BullMQ então achava o lote vazio e "terminava com
    // sucesso" (`status: 'EMPTY'`) sem nunca responder — o aluno via "digitando…" e
    // silêncio permanente, e o handler de DLQ nunca disparava (BullMQ não via isto como
    // falha). Mesmo padrão de resiliência já usado em `ProtocolGeneratorService.
    // retrieveEvidence` para o RAG: uma faceta indisponível não pode derrubar o pipeline
    // inteiro — aqui, degrada pra Etapa 2 (fallback nano), o mesmo caminho já usado quando
    // o kNN tem baixa confiança.
    try {
      const vec = await this.embedding.embed(scrubPII(input.message, input.user));
      const knn = await this.repo.classifyByKnn(vec);
      if (knn && knn.confidence >= KNN_MIN_CONFIDENCE && isIntent(knn.intent)) {
        return {
          intent: knn.intent,
          confidence: knn.confidence,
          stage: 'KNN',
          safetyHandoff: isEmergency(knn.intent),
        };
      }
    } catch (error) {
      this.logger.warn(
        { userId: input.userId, err: error },
        'embedding-kNN indisponível na classificação de intenção — usando fallback nano',
      );
    }

    // Etapa 2 — fallback nano (só os ambíguos).
    const intent = await this.fallback(input);
    return { intent, confidence: 0.5, stage: 'FALLBACK', safetyHandoff: isEmergency(intent) };
  }

  private async fallback(input: ClassifyInput): Promise<Intent> {
    const result = await this.llm.complete({
      purpose: 'AI_RESPONSE',
      userId: input.userId,
      user: input.user,
      dataClass: 'HEALTH',
      system:
        'Classifique a mensagem do usuário em UMA destas intenções e responda só com o rótulo, ' +
        `sem mais nada: ${INTENTS.join(', ')}. ` +
        'Use EMERGENCIA_CLINICA sempre que houver qualquer sinal de risco à saúde ou à vida ' +
        '(dor anormal, sintoma cardíaco/neurológico, desmaio, automutilação) — na dúvida entre ' +
        'EMERGENCIA_CLINICA e outra intenção, escolha EMERGENCIA_CLINICA.',
      messages: [{ role: 'user', content: wrapUserMessage(input.message) }],
      maxTokens: 20,
      intent: 'intent_classification',
    });
    return parseIntent(result.text);
  }
}

/** Único ponto que decide handoff de segurança fora do guardrail regex (Etapa 0). */
function isEmergency(intent: Intent): boolean {
  return intent === 'EMERGENCIA_CLINICA';
}

/** Extrai um rótulo conhecido da saída do nano; desconhecido → `FORA_DE_ESCOPO` (fail-safe). */
export function parseIntent(text: string): Intent {
  const upper = text.toUpperCase();
  return INTENTS.find((i) => upper.includes(i)) ?? 'FORA_DE_ESCOPO';
}
