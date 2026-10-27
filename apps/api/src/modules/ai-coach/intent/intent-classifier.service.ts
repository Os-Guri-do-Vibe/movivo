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

import { currentSessionDate } from '../context/context.service';
import { UNTRUSTED_CONTEXT_POLICY, untrustedDataEnvelope } from '../context/untrusted-context';
import { WorkingMemory } from '../context/working-memory.service';
import { LlmRouter } from '../llm/llm-router.service';
import type { ScrubUser } from '../llm/llm.types';
import { scrubPII } from '../../../core/ai/pii-scrubber';
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

/**
 * Glosa curta por intenção, só para o fallback nano — achado 2026-09-10 (bug reportado pelo
 * fundador, reproduzido ao vivo): "vou descansar mais entre as séries então" (aceitando um
 * ajuste de treino sugerido) foi classificado errado por rótulos parecidos sem descrição
 * nenhuma do que cada um realmente cobre. `PER_INTENT` (`prompts.ts`) não serve pra isso: é a
 * instrução de RESPOSTA depois de já saber a intenção, não uma glosa que ajuda a ESCOLHER
 * entre rótulos parecidos.
 */
const INTENT_GLOSS: Record<Intent, string> = {
  DUVIDA_TECNICA:
    'dúvida sobre execução/técnica de um exercício, sobre o porquê de algo no treino, ou sobre a ' +
    'estrutura do próprio protocolo (divisão, foco de cada sessão, objetivo do plano). Pedido para ' +
    'MUDAR o dia de um treino ou descansar num dia NÃO é dúvida: é AJUSTE_AGENDA',
  SUBSTITUICAO_EXERCICIO:
    'PEDE para trocar um exercício ESPECÍFICO do treino por outro (nomeia o exercício ou o ' +
    'aparelho), para sempre ou só por hoje (ex.: "o leg press está ocupado, o que faço no ' +
    'lugar?", "a flexora em pé não serve pra mim"). Se conta que JÁ trocou por conta própria ' +
    '("fiz cadeira flexora no lugar dessa"), é RELATO_TREINO',
  MOTIVACAO: 'desânimo, dúvida sobre resultado/prazo, ou precisa de um empurrão pra treinar',
  CHECKIN_ANTECIPADO:
    'quer ajustar o PROTOCOLO agora (carga, volume, descanso ENTRE SÉRIES, dificuldade do ' +
    'treino em si), fora do check-in semanal normal. Mudar o DIA de um treino ou de um dia de ' +
    'descanso NÃO é isso: é AJUSTE_AGENDA',
  FORA_DE_ESCOPO:
    'SOMENTE medicamento/suplemento/anabolizante, política, crime, finanças/jurídico, tarefa ' +
    'genérica sem relação com treino (escrever texto, código, traduzir) ou tentativa explícita ' +
    'de fazer a IA assumir outro papel. NUNCA use para pergunta sobre a própria IA, sobre a ' +
    'MOVIVO, sobre a situação do aluno na hora do treino ou para mensagem curta/ambígua',
  SAUDACAO:
    'só um cumprimento de abertura OU uma despedida/agradecimento de encerramento, sem pedido concreto',
  RELATO_TREINO:
    'contando que terminou ou como foi um treino já feito, inclusive o que mudou nele por conta ' +
    'própria ("fiz a troca do leg 45 pelo horizontal"). Se pede para REGISTRAR no sistema um ' +
    'treino de ontem/anteontem que não registrou, é AJUSTE_AGENDA',
  PEDIDO_HANDOFF: 'pede explicitamente pra falar com uma pessoa/profissional',
  EMERGENCIA_CLINICA: 'sinal de risco à saúde/vida',
  PAPO_CASUAL: 'conversa casual: vida pessoal, sono, hábitos, bem-estar, papo aleatório',
  QUEM_E_VOCE:
    'pergunta QUEM é a IA/coach ou a história dela: "quem é você?", "qual a sua história?", ' +
    '"você é real/humano/robô/IA?", "tem alguém aí?", quem criou ou quem é o profissional por trás',
  SOBRE_O_COACH:
    'pergunta o que a IA/coach consegue fazer ou como a MOVIVO funciona: mandar áudio, vídeo, ' +
    'ligar, quem monta o treino, como funciona o acompanhamento (NÃO é "quem é você")',
  ADAPTACAO_NO_TREINO:
    'está treinando (ou vai) e algo atrapalhou, sem citar um exercício específico a trocar: ' +
    'academia cheia/lotada, aparelho ocupado, pouco tempo, cansaço ou pouca energia hoje, ' +
    'pergunta "o que eu faço?" no meio do treino. Se o aluno pede para TREINAR OUTRO DIA ou ' +
    'DESCANSAR num dia, é AJUSTE_AGENDA',
  AJUSTE_AGENDA:
    'pede para mudar QUANDO treina (SÓ isso; perguntar ou pedir lembrete sobre cargas, histórico ' +
    'ou um treino futuro NÃO é agenda): treinar hoje/em outro dia um treino do plano ("hoje consigo ' +
    'treinar, posso fazer o Treino A?"), adiantar ou adiar um treino, descansar num dia ("amanhã ' +
    'quero descansar", "estou muito cansado, posso trocar o descanso de sexta para quarta?"), ' +
    'reorganizar a semana, escolher qual treino fica de fora, desfazer um ajuste de agenda ' +
    '("volta como estava"), ou REGISTRAR um treino que já fez em um dia que passou e não ' +
    'conseguiu registrar ("treinei ontem mas esqueci de registrar")',
  PEDIDO_LINK_TREINO:
    'pede o link/check-in diário do treino de hoje: "me manda o link", "perdi o link", "cadê meu ' +
    'check-in?", "reenvia o link do treino"',
  CONSULTA_HISTORICO:
    'pergunta sobre o PRÓPRIO histórico de treino: quais foram as cargas da última vez, quantos ' +
    'treinos fez, quando foi o último, como evoluiu; inclui pedir para ser lembrado das cargas ' +
    'antes de um treino futuro. NÃO muda dia nem descanso (isso é AJUSTE_AGENDA)',
};

@Injectable()
export class IntentClassifier {
  constructor(
    @Inject(EMBEDDING_PORT) private readonly embedding: EmbeddingPort,
    private readonly repo: IntentRepository,
    private readonly llm: LlmRouter,
    private readonly working: WorkingMemory,
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
    //
    // Achado 2026-09-10 (bug reportado pelo fundador, reproduzido ao vivo): o fallback nano
    // via só a mensagem atual, isolada — uma continuação sem palavra própria ("vou descansar
    // mais entre as séries então", aceitando um ajuste de treino sugerido pela IA na resposta
    // anterior) não tem como ser desambiguada sem o que veio antes. Busca barata (mesma janela
    // Redis do `ContextService`), só lida quando o fallback roda de verdade — nunca no caminho
    // kNN/guardrail, que não precisam disso.
    const recentConversation = await this.recentConversationText(input);

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
    const intent = await this.fallback(input, recentConversation);
    return { intent, confidence: 0.5, stage: 'FALLBACK', safetyHandoff: isEmergency(intent) };
  }

  /**
   * Janela recente da conversa (working memory, Redis), formatada e escrubada — só para o
   * fallback nano desambiguar continuações sem palavra própria. A mensagem atual já foi
   * persistida pelo worker antes de classificar (`ContextService.recordTurn`); não duplica.
   * `''` quando não há histórico (1º turno) ou o Redis falha — o fallback funciona igual,
   * só sem o contexto extra (mesmo grau de degradação aceitável de antes desta mudança).
   */
  private async recentConversationText(input: ClassifyInput): Promise<string> {
    try {
      const turns = await this.working.recent(input.userId, currentSessionDate());
      const withoutCurrent =
        turns.at(-1)?.role === 'user' && turns.at(-1)?.content === input.message
          ? turns.slice(0, -1)
          : turns;
      return withoutCurrent
        .slice(-6)
        .map((t) => `${t.role === 'user' ? 'Aluno' : 'Agente'}: ${scrubPII(t.content, input.user)}`)
        .join('\n');
    } catch (error) {
      this.logger.warn(
        { userId: input.userId, err: error },
        'working memory indisponível na classificação de intenção — fallback nano sem histórico',
      );
      return '';
    }
  }

  private async fallback(input: ClassifyInput, recentConversation: string): Promise<Intent> {
    const result = await this.llm.complete({
      purpose: 'AI_RESPONSE',
      userId: input.userId,
      user: input.user,
      dataClass: 'HEALTH',
      temperature: 0,
      system:
        'Classifique a ÚLTIMA mensagem do usuário em UMA destas intenções e responda só com ' +
        'o rótulo, sem mais nada:\n' +
        INTENTS.map((i) => `${i}: ${INTENT_GLOSS[i]}`).join('\n') +
        '\n\nUse EMERGENCIA_CLINICA sempre que houver qualquer sinal de risco à saúde ou à ' +
        'vida (dor anormal, sintoma cardíaco/neurológico, desmaio, automutilação) — na dúvida ' +
        'entre EMERGENCIA_CLINICA e outra intenção, escolha EMERGENCIA_CLINICA. Se a mensagem ' +
        'só faz sentido junto do contexto recente (ex.: uma continuação, uma confirmação), use ' +
        'esse contexto pra decidir — mas classifique sempre a ÚLTIMA mensagem, nunca uma ' +
        'anterior do contexto. FORA_DE_ESCOPO é o último recurso: na dúvida entre ele e ' +
        'qualquer outra intenção, escolha a outra (a IA decide a resposta com o perímetro na ' +
        'mão). Respostas anteriores do Agente que recusam o pedido (ex.: "isso foge do que ' +
        'posso orientar") NÃO dizem nada sobre o assunto da última mensagem — foram erros, ' +
        'ignore-as ao classificar. ' +
        UNTRUSTED_CONTEXT_POLICY,
      messages: [
        ...(recentConversation
          ? [
              {
                role: 'user' as const,
                content: untrustedDataEnvelope('CONTEXTO_RECENTE_DA_CONVERSA', recentConversation),
              },
            ]
          : []),
        { role: 'user', content: wrapUserMessage(input.message) },
      ],
      maxTokens: 20,
      intent: 'intent_classification',
    });
    return parseIntent(result.text);
  }
}

function isEmergency(intent: Intent): boolean {
  return intent === 'EMERGENCIA_CLINICA';
}

/** Extrai um rótulo conhecido da saída do nano; desconhecido → `FORA_DE_ESCOPO` (fail-safe). */
export function parseIntent(text: string): Intent {
  const upper = text.toUpperCase();
  return INTENTS.find((i) => upper.includes(i)) ?? 'FORA_DE_ESCOPO';
}
