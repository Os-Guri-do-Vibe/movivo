/**
 * `WorkoutFeedbackService` — comentário do Coach sobre o treino que o aluno acabou de
 * registrar no diário (`WorkoutJournalService.finish()`), achado 2026-09-12 (pedido do
 * fundador): antes disso, o AI Coach nunca via o diário fino (carga/reps/RPE/dor por
 * série) — só o agregado de `workout_completions`. Agora ele compara PLANEJADO
 * (prescrição do dia) com REALIZADO (séries de fato registradas) e comenta com base
 * nisso, em vez de confirmar o registro com uma frase genérica.
 *
 * Mesmo molde do `WorkoutPresentationService` (protocolo): LLM curto, guardrail de
 * linguagem, **sempre best-effort** — nunca lança. Falha de LLM ou reprovação do
 * `ValidationService` devolvem `undefined`; quem chama simplesmente não manda a bolha
 * extra (o registro do treino em si já foi salvo, independente disso).
 */
import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import type { AgentPersona, BiologicalSex } from '@movivo/shared';

import { AgentPersonaService } from '../../core/agent-config/agent-persona.service';
import { LlmRouter } from '../ai-coach/llm/llm-router.service';
import type { ScrubUser } from '../ai-coach/llm/llm.types';
import { ValidationService } from '../protocol/validation/validation.service';
import { stripEmDash } from './response-formatter';

/** Uma série realmente registrada (ou pulada) pelo aluno. */
export interface RealizedSet {
  serie: number;
  reps: number | null;
  carga: number | null;
  unidade: string | null;
  duracaoSegundos: number | null;
  concluida: boolean;
  pulada: boolean;
}

export interface RealizedExercise {
  exercicio: string;
  series: RealizedSet[];
}

/** Uma linha de histórico recente, tamanho fixo — mesmo espírito da ficha de periodização. */
export interface WorkoutHistoryLine {
  data: string;
  resumo: string;
}

export interface WorkoutFeedbackParams {
  userId: string;
  user: ScrubUser;
  biologicalSex: BiologicalSex | null;
  /** Foco/exercícios planejados para a sessão (snapshot já salvo em `workout_sessions.prescription`). */
  planejado: { foco: string; exercicios: { name: string; sets: number }[] };
  realizado: RealizedExercise[];
  esforcoPercebido: number | null;
  dorRelatada: boolean;
  comentarioDoAluno?: string;
  /** Últimas sessões concluídas ANTES desta, resumidas — contexto, não repetição do dado bruto. */
  historicoRecente: WorkoutHistoryLine[];
}

function systemPrompt(persona: AgentPersona, dorRelatada: boolean): string {
  const painNote = dorRelatada
    ? '\n\nO aluno relatou dor/desconforto nesta sessão — isso já acionou um alerta interno ' +
      'para o profissional CREF avaliar. Reconheça o relato com cuidado, sem minimizar e sem ' +
      'ignorá-lo, mas NUNCA comente causa, gravidade, ou o que fazer a respeito — apenas que ' +
      'foi registrado e será acompanhado pelo profissional responsável.'
    : '';
  return (
    `Você é ${persona.agentName}, ${persona.agentSelfIntro}. Tom de voz: ` +
    `${persona.toneDescriptors.join(', ')}.\n\n` +
    'Tarefa: o aluno acabou de registrar o treino de hoje no diário. Escreva um comentário ' +
    'breve e factual comparando o que foi PLANEJADO com o que foi de fato REALIZADO (carga, ' +
    'repetições, esforço percebido). Parabenize esforço ou progresso real quando os dados ' +
    'sustentarem isso; dê uma orientação prática e específica para a próxima sessão quando ' +
    'notar estagnação, queda de esforço, séries puladas ou desvio relevante do planejado. ' +
    'Baseie-se SOMENTE nos números e fatos fornecidos — nunca invente um dado que não recebeu. ' +
    '2 a 4 frases curtas, texto corrido, sem listas, sem markdown, sem emoji.' +
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

function userPrompt(params: WorkoutFeedbackParams): string {
  const lines = [
    `Treino planejado hoje (${params.planejado.foco}): ${params.planejado.exercicios
      .map((e) => `${e.name} (${e.sets} séries)`)
      .join(', ')}.`,
  ];
  for (const exercise of params.realizado) {
    const series = exercise.series
      .map((s) => {
        if (s.pulada) return `série ${s.serie} pulada`;
        const carga = s.carga !== null ? `${s.carga}${(s.unidade ?? '').toLowerCase()}` : 's/carga';
        const reps =
          s.reps !== null ? `${s.reps} reps` : s.duracaoSegundos ? `${s.duracaoSegundos}s` : '';
        return `série ${s.serie}: ${carga}${reps ? `, ${reps}` : ''}${s.concluida ? '' : ' (não concluída)'}`;
      })
      .join('; ');
    lines.push(`${exercise.exercicio} — ${series || 'sem séries registradas'}.`);
  }
  lines.push(
    `Esforço percebido informado pelo aluno (0-10): ${params.esforcoPercebido ?? 'não informado'}.`,
  );
  lines.push(`Dor/desconforto relatado nesta sessão: ${params.dorRelatada ? 'sim' : 'não'}.`);
  if (params.comentarioDoAluno) {
    lines.push(`Comentário livre do aluno sobre o treino: "${params.comentarioDoAluno}"`);
  }
  if (params.historicoRecente.length) {
    lines.push('Histórico recente (sessões anteriores, mais recente por último):');
    for (const item of params.historicoRecente) lines.push(`${item.data}: ${item.resumo}`);
  }
  return lines.join('\n');
}

@Injectable()
export class WorkoutFeedbackService {
  constructor(
    private readonly llm: LlmRouter,
    private readonly validation: ValidationService,
    private readonly agentPersona: AgentPersonaService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(WorkoutFeedbackService.name);
  }

  async comment(params: WorkoutFeedbackParams): Promise<string | undefined> {
    try {
      const persona = await this.agentPersona.persona(params.biologicalSex);
      const result = await this.llm.complete({
        purpose: 'AI_RESPONSE',
        userId: params.userId,
        user: params.user,
        system: systemPrompt(persona, params.dorRelatada),
        messages: [{ role: 'user', content: userPrompt(params) }],
        temperature: 0.6,
        maxTokens: 300,
        cache: false,
        intent: 'workout_feedback',
      });

      const text = stripEmDash(result.text.trim());
      const verdict = this.validation.validateResponse(text);
      if (verdict.action !== 'PASS') {
        this.logger.warn(
          { userId: params.userId, action: verdict.action, violations: verdict.violations },
          'comentário de treino reprovado na validação — bolha omitida',
        );
        return undefined;
      }
      return text || undefined;
    } catch (error) {
      this.logger.warn(
        { userId: params.userId, err: error instanceof Error ? error.message : String(error) },
        'geração do comentário de treino falhou — bolha omitida',
      );
      return undefined;
    }
  }
}
