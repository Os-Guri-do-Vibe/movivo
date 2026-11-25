import type { MealSlot } from '@movivo/shared';

/** Trabalhos da fila `student-follow-up` (acompanhamento ativo dos agentes). Quem produz e quem consome falam por este contrato. */
export type FollowUpJob =
  | { kind: 'PAIN' | 'WORKOUT_FEEDBACK'; userId: string; executionId: string }
  | { kind: 'MEAL_REMINDER'; userId: string; slot: MealSlot }
  | { kind: 'DAY_SUMMARY' | 'LOGGING_GAP'; userId: string }
  /**
   * Leitura dos especialistas sobre o dia do aluno. `source`: o check-in do dia, um relato no
   * chat ou o estudo noturno. `replyAlways`: o aluno só relatou o dia, e a resposta é obrigatória.
   */
  | {
      kind: 'SPECIALIST_DAILY';
      userId: string;
      source?: 'CHECK_IN' | 'CHAT' | 'NIGHTLY';
      replyAlways?: boolean;
    }
  /** Varredura por minuto da rotina alimentar (lembretes, resumo do dia, falha de registro). */
  | { kind: 'MEAL_SCAN' }
  | {
      kind: 'MISSED_SESSION' | 'MEMORY_CURATE' | 'NUTRITION_FOLLOW_UP' | 'TRAINING_FOLLOW_UP';
      userId: string;
    }
  /** Cuidado diário: escada de silêncio e lembrete (11:00), estudo da noite (21:00), fecho do dia (23:50). */
  | { kind: 'CARE'; userId: string; task: 'DAILY' | 'NIGHTLY' | 'DIGEST_CLOSE' }
  /** Varredura por minuto do cuidado diário. */
  | { kind: 'CARE_SCAN' }
  /** Revisão de qualidade de uma mensagem que os agentes enviaram. */
  | { kind: 'QUALITY_REVIEW'; userId: string; dedupeId: string; flow: string; text: string }
  /** Varredura semanal dos especialistas (também a execução manual do painel). */
  | { kind: 'SCAN'; force?: boolean; scriptId?: string };

/** Mensagens do aluno chegam em rajada: um trabalho de memória cobre uma janela de dez minutos. */
export const MEMORY_CURATE_WINDOW_MS = 10 * 60_000;
