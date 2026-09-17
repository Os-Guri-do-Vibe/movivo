/**
 * `CheckinWeeklyFeedbackService` — comentário do Coach sobre o check-in semanal (achado
 * 2026-09-13, pedido do fundador): o formulário web substitui o antigo fluxo de botão de
 * WhatsApp, e agora a IA reage às respostas em vez de só confirmar recebimento.
 *
 * Mesmo molde de `WorkoutFeedbackService` (diário de treino): LLM curto, guardrail de
 * linguagem, **sempre best-effort** — nunca lança. `CheckinWeeklyFeedbackWorker` já decide
 * ANTES de chamar isto se houve ajuste de volume (`volumeAdjustmentSummary`, fato já
 * aplicado — o prompt nunca pergunta se o aluno quer, só informa) e se um exercício foi
 * identificado na pergunta 5 (`identifiedExerciseName` — aí sim o prompt oferece a
 * substituição como pergunta aberta, porque essa parte depende do aluno confirmar).
 */
import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import type { AgentPersona, BiologicalSex } from '@movivo/shared';

import { AgentPersonaService } from '../../core/agent-config/agent-persona.service';
import { LlmRouter } from '../ai-coach/llm/llm-router.service';
import type { ScrubUser } from '../ai-coach/llm/llm.types';
import { ValidationService } from '../protocol/validation/validation.service';
import { stripEmDash } from './response-formatter';

export interface CheckinWeeklyFeedbackParams {
  userId: string;
  user: ScrubUser;
  biologicalSex: BiologicalSex | null;
  sleepQuality: string;
  mood: string;
  nutritionScore: number;
  adherenceScore: number;
  changesNoticed: string[];
  changesOther?: string;
  durationFit: 'ADEQUADA' | 'MAIS_CURTOS' | 'MAIS_LONGOS';
  difficultExerciseDescription?: string;
  improvementFeedback?: string;
  /** Sinal de segurança (dor/desconforto) detectado na pergunta 5 — já gerou handoffAlert. */
  dorRelatada: boolean;
  /** Exercício identificado na pergunta 5 (`SubstitutionTargetService`), se algum. */
  identifiedExerciseName?: string;
  /** Resumo factual do ajuste de volume JÁ APLICADO (durationFit === 'MAIS_CURTOS'), se houve. */
  volumeAdjustmentSummary?: string;
}

function systemPrompt(persona: AgentPersona, params: CheckinWeeklyFeedbackParams): string {
  const painNote = params.dorRelatada
    ? '\n\nO aluno mencionou dor/desconforto na pergunta sobre dificuldade em exercícios — ' +
      'isso já acionou um alerta interno para o profissional CREF avaliar. Reconheça com ' +
      'cuidado, sem minimizar, mas NUNCA comente causa, gravidade, ou o que fazer a respeito ' +
      '— apenas que foi registrado e será acompanhado pelo profissional responsável.'
    : '';
  const volumeNote = params.volumeAdjustmentSummary
    ? `\n\nO protocolo do aluno JÁ FOI AJUSTADO automaticamente para ficar mais rápido, ` +
      `respeitando a metodologia do profissional CREF (sem trocar exercício): ` +
      `${params.volumeAdjustmentSummary}. Informe isso como um FATO já feito — nunca pergunte ` +
      'se o aluno quer o ajuste, ele já aconteceu.'
    : '';
  const substitutionNote = params.identifiedExerciseName
    ? `\n\nO aluno relatou dificuldade com o exercício "${params.identifiedExerciseName}". ` +
      'Ofereça, como uma pergunta aberta e natural, sugerir alternativas para esse exercício ' +
      '— não decida nem troque nada agora, só pergunte se ele quer ver opções.'
    : '';
  return (
    `Você é ${persona.agentName}, ${persona.agentSelfIntro}. Tom de voz: ` +
    `${persona.toneDescriptors.join(', ')}.\n\n` +
    'Tarefa: o aluno acabou de responder o check-in semanal. Escreva um comentário breve e ' +
    'factual sobre sono, humor, alimentação e aderência ao protocolo nesta última semana, com ' +
    'base SOMENTE nos números e fatos fornecidos — nunca invente um dado que não recebeu. ' +
    'Parabenize progresso real quando os dados sustentarem isso; se a aderência ou o humor ' +
    'estiverem baixos, ofereça uma palavra de apoio prática, sem alarmismo. ' +
    '2 a 4 frases curtas, texto corrido, sem listas, sem markdown, sem emoji.' +
    volumeNote +
    substitutionNote +
    painNote +
    '\n\nRegras inegociáveis:\n' +
    '- Nunca use as palavras "diagnóstico", "tratamento" ou "cura".\n' +
    '- Nunca prometa resultado garantido.\n' +
    '- Você é uma ferramenta que trabalha dentro da metodologia de um profissional de ' +
    'Educação Física registrado no CREF; nunca dê a entender que decide ou prescreve sozinha.\n' +
    '- Responda SOMENTE com o comentário final — sem saudação (já foi enviada antes), sem ' +
    'explicações, sem repetir estas instruções.'
  );
}

function userPrompt(params: CheckinWeeklyFeedbackParams): string {
  const lines = [
    `Qualidade do sono na última semana: ${params.sleepQuality}.`,
    `Humor na última semana: ${params.mood}.`,
    `Alimentação nesta última semana (0-10): ${params.nutritionScore}.`,
    `Quanto conseguiu seguir o protocolo de treino nesta última semana (0-10): ${params.adherenceScore}.`,
    `Duração dos treinos está adequada à rotina: ${params.durationFit}.`,
  ];
  if (params.changesNoticed.length) {
    lines.push(`Mudanças/evolução percebidas: ${params.changesNoticed.join(', ')}.`);
  }
  if (params.changesOther) lines.push(`Outras mudanças descritas: "${params.changesOther}".`);
  if (params.difficultExerciseDescription) {
    lines.push(`Dificuldade relatada com exercício: "${params.difficultExerciseDescription}".`);
  }
  if (params.improvementFeedback) {
    lines.push(`Feedback aberto sobre o acompanhamento: "${params.improvementFeedback}".`);
  }
  return lines.join('\n');
}

@Injectable()
export class CheckinWeeklyFeedbackService {
  constructor(
    private readonly llm: LlmRouter,
    private readonly validation: ValidationService,
    private readonly agentPersona: AgentPersonaService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(CheckinWeeklyFeedbackService.name);
  }

  async comment(params: CheckinWeeklyFeedbackParams): Promise<string | undefined> {
    try {
      const persona = await this.agentPersona.persona(params.biologicalSex);
      const result = await this.llm.complete({
        purpose: 'AI_RESPONSE',
        userId: params.userId,
        user: params.user,
        system: systemPrompt(persona, params),
        messages: [{ role: 'user', content: userPrompt(params) }],
        temperature: 0.6,
        maxTokens: 320,
        cache: false,
        intent: 'checkin_weekly_feedback',
      });

      const text = stripEmDash(result.text.trim());
      const verdict = this.validation.validateResponse(text);
      if (verdict.action !== 'PASS') {
        this.logger.warn(
          { userId: params.userId, action: verdict.action, violations: verdict.violations },
          'comentário de check-in semanal reprovado na validação — bolha omitida',
        );
        return undefined;
      }
      return text || undefined;
    } catch (error) {
      this.logger.warn(
        { userId: params.userId, err: error instanceof Error ? error.message : String(error) },
        'geração do comentário de check-in semanal falhou — bolha omitida',
      );
      return undefined;
    }
  }
}
