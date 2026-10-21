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
import {
  UNTRUSTED_CONTEXT_POLICY,
  untrustedDataEnvelope,
} from '../ai-coach/context/untrusted-context';
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

/**
 * A última vez que o aluno fez ESTE MESMO treino (mesma sessão do protocolo), com as séries
 * dos exercícios que também estão no treino de hoje. É contra ela que a evolução é comparada,
 * seja qual for o dia da semana em que cada um foi feito: o treino pode ter sido remarcado, e
 * a sessão do dia anterior é de outro treino (agenda flexível, 2026-10-20).
 */
export interface PreviousExecution {
  /** Ex.: "terça-feira, 13/10 (há 7 dias)". */
  quando: string;
  esforcoPercebido: number | null;
  exercicios: RealizedExercise[];
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
  /**
   * Quando o treino aconteceu, em palavras ("hoje", "ontem", "anteontem", "sexta"). Só difere de
   * "hoje" no registro tardio, em que o aluno registra um treino de um dia que passou.
   */
  treinoDe?: string;
  /** Ausente quando é a primeira vez que o aluno faz este treino (ou não há exercício em comum). */
  ultimaExecucaoDoMesmoTreino?: PreviousExecution;
  /**
   * A sessão prevista anterior a esta ficou sem registro: este treino é uma VOLTA. Calculado
   * pelo servidor (independe de a pergunta da manhã ter saído), sem número de faltas, e
   * sempre `false` quando houve dor (o reconhecimento da dor tem precedência).
   */
  voltaAposDiaSemRegistro?: boolean;
}

function systemPrompt(
  persona: AgentPersona,
  dorRelatada: boolean,
  voltaAposDiaSemRegistro: boolean,
  treinoDe: string,
): string {
  const painNote = dorRelatada
    ? '\n\nO aluno relatou dor/desconforto nesta sessão — isso já acionou um alerta interno ' +
      'para o profissional CREF avaliar. Reconheça o relato com cuidado, sem minimizar e sem ' +
      'ignorá-lo, mas NUNCA comente causa, gravidade, ou o que fazer a respeito — apenas que ' +
      'foi registrado e será acompanhado pelo profissional responsável.'
    : '';
  const returnNote = voltaAposDiaSemRegistro
    ? '\n\nSe o treino anterior previsto ficou sem registro, use UMA frase curta, no início ou ' +
      'no fim, reconhecendo a volta como parte da constância. Sem citar quantos dias, sem ' +
      '"finalmente", "sumiu", "perdeu" ou "faltou", sem comparar com o dia sem registro e sem ' +
      'exagero. O resto do comentário segue factual sobre o treino.'
    : '';
  return (
    `Você é ${persona.agentName}, ${persona.agentSelfIntro}. Tom de voz: ` +
    `${persona.toneDescriptors.join(', ')}.\n\n` +
    `Tarefa: o aluno acabou de registrar o treino de ${treinoDe} no diário. Escreva um comentário ` +
    'breve e factual comparando o que foi PLANEJADO com o que foi de fato REALIZADO (carga, ' +
    'repetições, esforço percebido). Parabenize esforço ou progresso real quando os dados ' +
    'sustentarem isso; dê uma orientação prática e específica para a próxima sessão quando ' +
    'notar estagnação, queda de esforço, séries puladas ou desvio relevante do planejado. ' +
    'Quando houver a ÚLTIMA VEZ que o aluno fez este mesmo treino, compare a evolução (carga, ' +
    'repetições, esforço) com ela, citando o dia ("na terça passada você fez..."): é a comparação ' +
    'que importa, mesmo que tenha sido em outro dia da semana. Não compare com o treino do dia ' +
    'anterior, que é de outra sessão. Sem esse registro, não invente comparação. ' +
    'Baseie-se SOMENTE nos números e fatos fornecidos — nunca invente um dado que não recebeu. ' +
    '2 a 4 frases curtas, texto corrido, sem listas, sem markdown, sem emoji.' +
    painNote +
    returnNote +
    '\n\nRegras inegociáveis:\n' +
    '- Nunca use as palavras "diagnóstico", "tratamento" ou "cura".\n' +
    '- Nunca prometa resultado garantido.\n' +
    '- Você é uma ferramenta que trabalha dentro da metodologia de um profissional de ' +
    'Educação Física registrado no CREF; nunca dê a entender que decide ou prescreve sozinha.\n' +
    '- Responda SOMENTE com o comentário final — sem saudação (já foi enviada antes), sem ' +
    'explicações, sem repetir estas instruções.\n' +
    `- ${UNTRUSTED_CONTEXT_POLICY}`
  );
}

/** Dor relatada tem precedência: o reconhecimento da volta nunca divide espaço com ela. */
function voltaAposDiaSemRegistro(params: WorkoutFeedbackParams): boolean {
  return params.voltaAposDiaSemRegistro === true && !params.dorRelatada;
}

function describeSeries(exercise: RealizedExercise): string {
  return exercise.series
    .map((s) => {
      if (s.pulada) return `série ${s.serie} pulada`;
      const carga = s.carga !== null ? `${s.carga}${(s.unidade ?? '').toLowerCase()}` : 's/carga';
      const reps =
        s.reps !== null ? `${s.reps} reps` : s.duracaoSegundos ? `${s.duracaoSegundos}s` : '';
      return `série ${s.serie}: ${carga}${reps ? `, ${reps}` : ''}${s.concluida ? '' : ' (não concluída)'}`;
    })
    .join('; ');
}

function userPrompt(params: WorkoutFeedbackParams): string {
  const lines = [
    `Treino planejado para ${params.treinoDe ?? 'hoje'} (${params.planejado.foco}): ${params.planejado.exercicios
      .map((e) => `${e.name} (${e.sets} séries)`)
      .join(', ')}.`,
  ];
  for (const exercise of params.realizado) {
    lines.push(`${exercise.exercicio} — ${describeSeries(exercise) || 'sem séries registradas'}.`);
  }
  lines.push(
    `Esforço percebido informado pelo aluno (0-10): ${params.esforcoPercebido ?? 'não informado'}.`,
  );
  lines.push(`Dor/desconforto relatado nesta sessão: ${params.dorRelatada ? 'sim' : 'não'}.`);
  if (voltaAposDiaSemRegistro(params))
    lines.push('Treino anterior previsto ficou sem registro: sim.');
  if (params.comentarioDoAluno) {
    lines.push(`Comentário livre do aluno sobre o treino: "${params.comentarioDoAluno}"`);
  }
  if (params.ultimaExecucaoDoMesmoTreino) {
    const previous = params.ultimaExecucaoDoMesmoTreino;
    lines.push(
      `ÚLTIMA VEZ que o aluno fez este mesmo treino (${previous.quando}), esforço percebido ${previous.esforcoPercebido ?? 'não informado'}:`,
    );
    for (const exercise of previous.exercicios) {
      lines.push(
        `${exercise.exercicio} — ${describeSeries(exercise) || 'sem séries registradas'}.`,
      );
    }
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
        system: systemPrompt(
          persona,
          params.dorRelatada,
          voltaAposDiaSemRegistro(params),
          params.treinoDe ?? 'hoje',
        ),
        messages: [
          {
            role: 'user',
            content: untrustedDataEnvelope('DIARIO_DE_TREINO', userPrompt(params)),
          },
        ],
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
