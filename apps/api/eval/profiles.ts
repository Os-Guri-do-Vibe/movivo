/**
 * Perfis SINTÉTICOS espelhando o desenho dos casos reais de produção (nenhum dado de aluno):
 * mesmas combinações de nível/objetivo/dias/tempo/ênfase/tags que apareceram na fila do RT.
 */
import type { UserConstraints } from '../src/modules/protocol/user-constraints';

const base = {
  equipment: [] as string[],
  avoid: [] as string[],
  injuriesRaw: [] as string[],
  injuryTags: [] as UserConstraints['injuryTags'],
  requiresProfessionalReview: false,
  parqTags: [] as UserConstraints['parqTags'],
  parqTriggered: [] as UserConstraints['parqTriggered'],
  trainingStatus: 'REGULAR' as UserConstraints['trainingStatus'],
  location: 'FULL_GYM' as UserConstraints['location'],
  routineContext:
    'Atividades anteriores: musculação.\nBarreiras de consistência: falta de tempo.\nPeríodo preferido: MORNING.\nNão declarou prática de outro esporte.',
};

/** Política de dor sem veto (2026-10-21). `EVAL_CAUTION=0` reproduz o veto total anterior. */
const WITH_CAUTION = process.env.EVAL_CAUTION !== '0';

const D = (...d: string[]) => d as UserConstraints['preferredDays'];
const MON_FRI5 = D('MON', 'TUE', 'WED', 'THU', 'FRI');

export interface EvalProfile {
  id: string;
  note: string;
  constraints: UserConstraints;
}

export const PROFILES: EvalProfile[] = [
  {
    id: 'adv-abc5-90-costas-peito',
    note: 'avançado, 5d/90min, ênfase costas+peito (caso 41de3354)',
    constraints: {
      ...base,
      goal: 'GAIN_MUSCLE',
      level: 'AVANCADO',
      daysPerWeek: 5,
      preferredDays: MON_FRI5,
      sessionMinutes: 90,
      emphasis: ['costas', 'peito'],
    },
  },
  {
    id: 'adv-3d-90-bracos-quad',
    note: 'avançado, 3d/90min, ênfase bíceps+tríceps+quadríceps (caso c542b4b6)',
    constraints: {
      ...base,
      goal: 'GAIN_MUSCLE',
      level: 'AVANCADO',
      daysPerWeek: 3,
      preferredDays: D('MON', 'THU', 'FRI'),
      sessionMinutes: 90,
      emphasis: ['bíceps', 'tríceps', 'quadríceps'],
    },
  },
  {
    id: 'adv-ppl6-90-elbow',
    note: 'avançado, 6d/90min, ênfase peito+costas, dor de cotovelo (caso ed9cab5f → fallback)',
    constraints: {
      ...base,
      goal: 'GAIN_MUSCLE',
      level: 'AVANCADO',
      daysPerWeek: 6,
      preferredDays: D('MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'),
      sessionMinutes: 90,
      emphasis: ['peito', 'costas'],
      injuryTags: ['ELBOW'],
      cautionTags: WITH_CAUTION ? ['ELBOW'] : undefined,
      injuriesRaw: ['Dor em Cotovelo (intensidade 3/10)'],
    },
  },
  {
    id: 'int-fb4-60-shoulder',
    note: 'intermediário voltando, 4d/60min, ênfase ombro+core, dor de ombro (caso e93a456a)',
    constraints: {
      ...base,
      goal: 'GAIN_MUSCLE',
      level: 'INTERMEDIARIO',
      trainingStatus: 'STOPPED',
      stoppedFor: 'Y1_TO_2',
      daysPerWeek: 4,
      preferredDays: D('MON', 'TUE', 'THU', 'FRI'),
      sessionMinutes: 60,
      emphasis: ['ombro', 'core'],
      injuryTags: ['SHOULDER'],
      cautionTags: WITH_CAUTION ? ['SHOULDER'] : undefined,
      injuriesRaw: ['Dor em Ombro (intensidade 3/10)'],
    },
  },
  {
    id: 'int-abcd5-45-knee',
    note: 'intermediário, 5d/45min, ênfase glúteo+quadríceps, dor de joelho (caso e8f749b1)',
    constraints: {
      ...base,
      goal: 'GAIN_MUSCLE',
      level: 'INTERMEDIARIO',
      daysPerWeek: 5,
      preferredDays: MON_FRI5,
      sessionMinutes: 45,
      emphasis: ['glúteo', 'quadríceps'],
      injuryTags: ['KNEE'],
      cautionTags: WITH_CAUTION ? ['KNEE'] : undefined,
      injuriesRaw: ['Dor em Joelho (intensidade 3/10)'],
    },
  },
  {
    id: 'int-ul5-45-lombar',
    note: 'intermediário, 5d/45min, saúde, ênfase costas+core, dor lombar (caso 2a288249)',
    constraints: {
      ...base,
      goal: 'HEALTH_ENERGY',
      level: 'INTERMEDIARIO',
      daysPerWeek: 5,
      preferredDays: MON_FRI5,
      sessionMinutes: 45,
      emphasis: ['costas', 'core'],
      injuryTags: ['LOWER_BACK'],
      cautionTags: WITH_CAUTION ? ['LOWER_BACK'] : undefined,
      injuriesRaw: ['Dor em Lombar (intensidade 3/10)'],
    },
  },
  {
    id: 'adv-ul4-90-ombro-peito',
    note: 'avançado, 4d/90min, ênfase ombro+peito (caso e1e1559d)',
    constraints: {
      ...base,
      goal: 'GAIN_MUSCLE',
      level: 'AVANCADO',
      daysPerWeek: 4,
      preferredDays: D('MON', 'TUE', 'THU', 'FRI'),
      sessionMinutes: 90,
      emphasis: ['ombro', 'peito'],
    },
  },
  {
    id: 'adv-ul4-30-peito-costas',
    note: 'avançado ocasional, 4d/30min, ênfase peito+costas (caso 5dac7fcb)',
    constraints: {
      ...base,
      goal: 'GAIN_MUSCLE',
      level: 'AVANCADO',
      trainingStatus: 'OCCASIONAL',
      daysPerWeek: 4,
      preferredDays: D('MON', 'TUE', 'THU', 'FRI'),
      sessionMinutes: 30,
      emphasis: ['peito', 'costas'],
      avoid: ['Não gosto de afundo, búlgaro, terra e stiff'],
    },
  },
  {
    id: 'int-abcde5-60-lose-fat',
    note: 'intermediário emagrecimento, 5d/60min, ênfase bíceps+tríceps+costas (caso dc89ee37)',
    constraints: {
      ...base,
      goal: 'LOSE_FAT',
      level: 'INTERMEDIARIO',
      daysPerWeek: 5,
      preferredDays: MON_FRI5,
      sessionMinutes: 60,
      emphasis: ['bíceps', 'tríceps', 'costas'],
    },
  },
  {
    id: 'adv-abcde5-60-quad-costas',
    note: 'avançado, 5d/60min, ênfase quadríceps+costas (caso ee8cf92f)',
    constraints: {
      ...base,
      goal: 'GAIN_MUSCLE',
      level: 'AVANCADO',
      daysPerWeek: 5,
      preferredDays: MON_FRI5,
      sessionMinutes: 60,
      emphasis: ['quadríceps', 'costas'],
    },
  },
  {
    id: 'adv-ppl6-90-gluteo',
    note: 'avançado, 6d/90min, ênfase glúteo+posterior (caso 2ed83aa2)',
    constraints: {
      ...base,
      goal: 'GAIN_MUSCLE',
      level: 'AVANCADO',
      daysPerWeek: 6,
      preferredDays: D('MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'),
      sessionMinutes: 90,
      emphasis: ['glúteo', 'posterior de coxa'],
    },
  },
  {
    id: 'int-abc3-45-quad-gluteo',
    note: 'intermediário, 3d/45min, ênfase quadríceps+glúteo (caso 9b595227)',
    constraints: {
      ...base,
      goal: 'GAIN_MUSCLE',
      level: 'INTERMEDIARIO',
      daysPerWeek: 3,
      preferredDays: D('MON', 'WED', 'FRI'),
      sessionMinutes: 45,
      emphasis: ['quadríceps', 'glúteo'],
    },
  },
  {
    id: 'adv-ul5-90-conditioning-arms',
    note: 'avançado condicionamento, 5d/90min, ênfase core+bíceps+tríceps (caso 37e07a98)',
    constraints: {
      ...base,
      goal: 'CONDITIONING',
      level: 'AVANCADO',
      daysPerWeek: 5,
      preferredDays: MON_FRI5,
      sessionMinutes: 90,
      emphasis: ['core', 'bíceps', 'tríceps'],
    },
  },
  {
    id: 'ini-ul4-60-multi-tags',
    note: 'iniciante emagrecimento, 4d/60min, lombar+joelho+tornozelo (caso ff24beb9 → fallback)',
    constraints: {
      ...base,
      goal: 'LOSE_FAT',
      level: 'INICIANTE',
      trainingStatus: 'OCCASIONAL',
      daysPerWeek: 4,
      preferredDays: D('MON', 'TUE', 'THU', 'FRI'),
      sessionMinutes: 60,
      emphasis: ['core', 'glúteo'],
      injuryTags: ['LOWER_BACK', 'KNEE', 'ANKLE'],
      cautionTags: WITH_CAUTION ? ['LOWER_BACK', 'KNEE', 'ANKLE'] : undefined,
      injuriesRaw: ['Dor em Lombar (intensidade 4/10)', 'Dor em Joelho (intensidade 3/10)'],
    },
  },
  {
    id: 'adv-ul4-60-knee-severe',
    note: 'avançado, 4d/60min, dor forte no joelho (intensidade 8/10): continua veto',
    constraints: {
      ...base,
      goal: 'GAIN_MUSCLE',
      level: 'AVANCADO',
      daysPerWeek: 4,
      preferredDays: D('MON', 'TUE', 'THU', 'FRI'),
      sessionMinutes: 60,
      emphasis: ['peito', 'costas'],
      injuryTags: ['KNEE'],
      injuriesRaw: ['Dor em Joelho (intensidade 8/10)'],
    },
  },
];
