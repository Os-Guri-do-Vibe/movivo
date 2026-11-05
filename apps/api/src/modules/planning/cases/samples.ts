/** Sessões de exemplo que alimentam os casos de nutrição e de reconciliação híbrida. */
import type { PlanSession } from '@movivo/shared';

import type { BlockOutput } from '../tasks/blocks';

function ex(exerciseId: string, name: string, sets: number, rest: number) {
  return {
    exerciseId,
    name,
    sets,
    reps: { min: 8, max: 12 },
    loadStrategy: 'DOUBLE_PROGRESSION' as const,
    rir: 2,
    restSeconds: rest,
  };
}

export function strengthSample(key: string, focus: string, frequency = 1, rpe = 7): PlanSession {
  return {
    key,
    title: focus,
    purpose: 'Desenvolver força e massa muscular com progressão de carga.',
    priority: 'KEY',
    weeklyFrequency: frequency,
    estimatedMinutes: 60,
    estimatedRpe: rpe,
    content: {
      modality: 'STRENGTH',
      focus,
      exercises: [
        ex('agachamento_barra', 'Agachamento com barra', 4, 120),
        ex('supino_reto_barra', 'Supino reto com barra', 4, 120),
        ex('remada_curvada_barra', 'Remada curvada com barra', 4, 120),
        ex('desenvolvimento_halter', 'Desenvolvimento com halteres', 3, 90),
        ex('leg_press_45_maquina', 'Leg press 45', 3, 90),
      ],
    },
  };
}

export function runningSample(
  key: string,
  kind: 'EASY' | 'LONG' | 'INTERVALS',
  options: { km: number; priority?: PlanSession['priority']; rpe?: number } = { km: 5 },
): PlanSession {
  const segments =
    kind === 'INTERVALS'
      ? [
          {
            type: 'WARMUP' as const,
            durationSeconds: 600,
            target: { by: 'ZONE' as const, zone: 'Z1' as const },
          },
          {
            type: 'WORK' as const,
            repeat: 5,
            distanceMeters: 800,
            target: { by: 'ZONE' as const, zone: 'Z4' as const },
          },
          {
            type: 'RECOVERY' as const,
            repeat: 5,
            durationSeconds: 120,
            target: { by: 'ZONE' as const, zone: 'Z1' as const },
          },
          {
            type: 'COOLDOWN' as const,
            durationSeconds: 600,
            target: { by: 'ZONE' as const, zone: 'Z1' as const },
          },
        ]
      : [
          {
            type: 'STEADY' as const,
            distanceMeters: options.km * 1_000,
            target: { by: 'ZONE' as const, zone: 'Z2' as const },
          },
        ];
  return {
    key,
    title: kind === 'LONG' ? 'Longão' : kind === 'INTERVALS' ? 'Intervalado' : 'Rodagem leve',
    purpose: 'Construir base aeróbia com segurança.',
    priority: options.priority ?? (kind === 'LONG' ? 'KEY' : 'IMPORTANT'),
    weeklyFrequency: 1,
    estimatedMinutes: kind === 'INTERVALS' ? 50 : Math.round(options.km * 6.5),
    estimatedRpe: options.rpe ?? (kind === 'INTERVALS' ? 8 : 4),
    content: { modality: 'RUNNING', kind, segments, terrain: 'ANY' },
  };
}

export function blockOf(sessions: PlanSession[], name: string): BlockOutput {
  return {
    summary: `Bloco de ${name}.`,
    phases: [
      {
        name: 'Base',
        focus: `Construir ${name} com consistência`,
        weeks: 4,
        endsWithDeload: false,
      },
    ],
    sessions,
    notes: [],
  };
}
