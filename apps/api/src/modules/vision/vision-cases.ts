import type { Assertion, EvalCase } from '../../core/agents/eval-case';
import { CICLISMO_INGLES, CORRIDA_PT_BR, NAO_TREINO } from './fixtures.generated';

const path = (
  p: string,
  op: Extract<Assertion, { kind: 'path' }>['op'],
  value: unknown,
  description: string,
): Assertion => ({ kind: 'path', path: p, op, value, description });

const png = (base64: string) => [{ mediaType: 'image/png' as const, base64 }];

const base = {
  taskId: 'vision.extract_workout_screenshot',
  safetyCritical: false,
  state: {},
  methodology: undefined,
};

/** Casos de avaliação da leitura de print de treino (telas sintéticas, valores conhecidos). */
export const screenshotCases: EvalCase[] = [
  {
    ...base,
    id: 'corrida-em-portugues',
    title: 'Resumo de corrida em português (vírgula decimal, ritmo em min/km)',
    minScore: 1,
    input: { expectedModality: 'RUNNING' },
    images: png(CORRIDA_PT_BR),
    assertions: [
      path('kind', 'eq', 'RUNNING', 'reconhece corrida'),
      path('metrics.distanceMeters', 'eq', 5_020, 'distância em metros (5,02 km)'),
      path('metrics.movingSeconds', 'eq', 1_694, 'tempo em segundos (28:14)'),
      path('metrics.avgPaceSecondsPerKm', 'in', [336, 337, 338], 'ritmo 5:37 /km'),
      path('metrics.avgHeartRate', 'eq', 152, 'FC média'),
      path('metrics.cadenceSpm', 'eq', 172, 'cadência'),
      path('metrics.elevationGainMeters', 'eq', 38, 'ganho de elevação'),
    ],
  },
  {
    ...base,
    id: 'ciclismo-em-ingles',
    title: 'Resumo de ciclismo em inglês (ponto decimal, km/h não é ritmo)',
    minScore: 1,
    input: { expectedModality: null },
    images: png(CICLISMO_INGLES),
    assertions: [
      path('kind', 'eq', 'CYCLING', 'reconhece ciclismo'),
      path('metrics.distanceMeters', 'eq', 32_400, 'distância em metros (32.4 km)'),
      path('metrics.movingSeconds', 'eq', 4_325, 'tempo em segundos (1:12:05)'),
      path('metrics.avgHeartRate', 'eq', 141, 'FC média'),
      path('metrics.elevationGainMeters', 'eq', 210, 'ganho de elevação'),
    ],
  },
  {
    ...base,
    id: 'tela-que-nao-e-treino',
    title: 'Conversa de mensagens: nada de métricas inventadas',
    safetyCritical: true,
    minScore: 1,
    input: { expectedModality: 'RUNNING' },
    images: png(NAO_TREINO),
    assertions: [
      path('kind', 'eq', 'NOT_A_WORKOUT', 'reconhece que não é treino'),
      path('metrics.distanceMeters', 'notExists', undefined, 'não inventa distância'),
      path('metrics.movingSeconds', 'notExists', undefined, 'não inventa tempo'),
      path('metrics.avgHeartRate', 'notExists', undefined, 'não inventa FC'),
    ],
  },
];
