/**
 * Estações do HYROX: o que cada uma exige e como treiná-la quando o aluno não tem o equipamento
 * oficial. Os agentes de HYROX e híbrido usam isto para montar sessões possíveis na academia
 * real do aluno; as cargas de prova por categoria ficam na metodologia (documento HYROX).
 */
import type { HyroxStation } from '@movivo/shared';

export interface HyroxStationProfile {
  station: HyroxStation;
  /** Distância/repetições oficiais por estação na prova. */
  raceVolume: string;
  /** Capacidades que a estação mais exige. */
  demands: readonly ('AEROBIC' | 'GRIP' | 'LEG_STRENGTH' | 'PUSH' | 'PULL' | 'CORE' | 'POWER')[];
  /** Equipamento oficial. */
  equipment: string;
  /** Alternativas quando o equipamento oficial não existe na academia do aluno. */
  alternatives: readonly string[];
}

export const HYROX_STATIONS: readonly HyroxStationProfile[] = [
  {
    station: 'SKIERG',
    raceVolume: '1.000 m',
    demands: ['AEROBIC', 'PULL', 'CORE'],
    equipment: 'SkiErg',
    alternatives: ['Puxada alta com elástico em ritmo contínuo', 'Remo ergômetro', 'Battle rope'],
  },
  {
    station: 'SLED_PUSH',
    raceVolume: '50 m (4 × 12,5 m)',
    demands: ['LEG_STRENGTH', 'PUSH', 'POWER'],
    equipment: 'Trenó com carga',
    alternatives: [
      'Empurrar esteira desligada (curva)',
      'Leg press pesado em séries curtas',
      'Afundo andando com carga',
    ],
  },
  {
    station: 'SLED_PULL',
    raceVolume: '50 m (4 × 12,5 m)',
    demands: ['PULL', 'GRIP', 'LEG_STRENGTH'],
    equipment: 'Trenó com corda',
    alternatives: [
      'Remada curvada pesada',
      'Puxada de corda/cabo de mão em mão',
      'Caminhada para trás puxando carga',
    ],
  },
  {
    station: 'BURPEE_BROAD_JUMP',
    raceVolume: '80 m',
    demands: ['POWER', 'AEROBIC', 'LEG_STRENGTH'],
    equipment: 'Nenhum',
    alternatives: ['Burpee + salto horizontal em espaço curto (ida e volta)'],
  },
  {
    station: 'ROWING',
    raceVolume: '1.000 m',
    demands: ['AEROBIC', 'PULL', 'LEG_STRENGTH'],
    equipment: 'Remo ergômetro',
    alternatives: ['SkiErg', 'Bike ergométrica em intensidade equivalente'],
  },
  {
    station: 'FARMERS_CARRY',
    raceVolume: '200 m',
    demands: ['GRIP', 'CORE'],
    equipment: 'Kettlebells/halteres',
    alternatives: ['Caminhada com halteres', 'Isometria de pegada na barra'],
  },
  {
    station: 'SANDBAG_LUNGES',
    raceVolume: '100 m',
    demands: ['LEG_STRENGTH', 'CORE'],
    equipment: 'Saco de areia',
    alternatives: ['Afundo andando com barra nas costas', 'Afundo andando com halteres'],
  },
  {
    station: 'WALL_BALLS',
    raceVolume: '100 repetições',
    demands: ['LEG_STRENGTH', 'PUSH', 'AEROBIC'],
    equipment: 'Medicine ball + alvo',
    alternatives: ['Thruster com halteres leves', 'Agachamento + arremesso com medicine ball'],
  },
];
