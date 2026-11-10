/**
 * Catálogo dos tipos de treino de corrida da MOVIVO.
 *
 * Cada tipo declara o estímulo, o objetivo fisiológico e a adaptação esperada, para o agente
 * especialista escolher e combinar os treinos conforme o nível, a fase e o objetivo do aluno. O
 * `kind` é a CLASSE do treino (a que as regras da metodologia e o planejador de semana
 * enxergam: leve, longão, limiar, intervalado…); `workoutType` é o treino específico dentro dela.
 *
 * Fonte: classificação por tipo de estímulo definida pela MOVIVO (7 grupos, 38 treinos). Texto
 * dos campos em português para o profissional e o aluno lerem como está.
 */
import { z } from 'zod';

import {
  RUNNING_SESSION_KIND_LABELS,
  runningWorkoutTypeSchema,
  type RunningSessionKind,
  type RunningWorkoutType,
} from './endurance.schema';

export const runningWorkoutCategorySchema = z.enum([
  'SPEED_POWER',
  'THRESHOLD',
  'AEROBIC',
  'INTERVALS',
  'TERRAIN',
  'TECHNIQUE',
  'RACE_SPECIFIC',
]);
export type RunningWorkoutCategory = z.infer<typeof runningWorkoutCategorySchema>;

export const RUNNING_WORKOUT_CATEGORY_LABELS: Readonly<Record<RunningWorkoutCategory, string>> = {
  SPEED_POWER: 'Velocidade e potência',
  THRESHOLD: 'Limiar e resistência em ritmos elevados',
  AEROBIC: 'Desenvolvimento aeróbio',
  INTERVALS: 'Intervalados e variações de estímulo',
  TERRAIN: 'Terrenos e condições específicas',
  TECHNIQUE: 'Técnica e neuromuscular',
  RACE_SPECIFIC: 'Específicos para provas e competição',
};

/** Fase da preparação de corrida (a periodização do bloco). */
export const runningPhaseSchema = z.enum(['BASE', 'BUILD', 'PEAK', 'TAPER', 'MAINTENANCE']);
export type RunningPhase = z.infer<typeof runningPhaseSchema>;

export const RUNNING_PHASE_LABELS: Readonly<Record<RunningPhase, string>> = {
  BASE: 'Base aeróbia',
  BUILD: 'Construção',
  PEAK: 'Pico',
  TAPER: 'Polimento',
  MAINTENANCE: 'Manutenção',
};

export type RunningWorkoutLevel = 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';

/** Quanto o treino pesa na semana: guia a escolha dos papéis (leve, qualidade, longão). */
export type RunningWorkoutIntensity = 'EASY' | 'MODERATE' | 'HARD' | 'NEUROMUSCULAR';

export interface RunningWorkoutSpec {
  label: string;
  category: RunningWorkoutCategory;
  /** Classe do treino: a que a metodologia, o planejador de semana e as telas já usam. */
  kind: RunningSessionKind;
  intensity: RunningWorkoutIntensity;
  /** O que a sessão pede (estrutura do estímulo). */
  stimulus: string;
  /** Para que serve (objetivo fisiológico). */
  objective: string;
  /** O que se espera que melhore com a repetição. */
  adaptation: string;
  /** Menor nível em que o treino é oferecido. */
  minLevel: RunningWorkoutLevel;
  /** Fases da preparação em que o treino faz sentido. */
  phases: readonly RunningPhase[];
  /** Terreno que o treino exige; ausente = qualquer. */
  terrain?: 'FLAT' | 'HILLS' | 'TRACK' | 'TREADMILL' | 'TRAIL' | 'SAND';
  /** Precisa do ritmo de 5 km para prescrever ritmos; sem ele, o treino usa PSE/zona. */
  needsPaceAnchor: boolean;
  /** Cuidado a respeitar ao prescrever. */
  caution?: string;
  /** `HYROX` não é montado pelo treinador de corrida (é sessão do bloco de HYROX). */
  scope: 'RUNNING' | 'HYROX';
}

const ALL_PHASES: readonly RunningPhase[] = ['BASE', 'BUILD', 'PEAK', 'TAPER', 'MAINTENANCE'];
const NOT_TAPER: readonly RunningPhase[] = ['BASE', 'BUILD', 'PEAK', 'MAINTENANCE'];
const BASE_BUILD: readonly RunningPhase[] = ['BASE', 'BUILD', 'MAINTENANCE'];
const BUILD_PEAK: readonly RunningPhase[] = ['BUILD', 'PEAK', 'MAINTENANCE'];

export const RUNNING_WORKOUTS: Readonly<Record<RunningWorkoutType, RunningWorkoutSpec>> = {
  // --- 1. Velocidade e potência -----------------------------------------------------------
  SPRINT_INTERVALS: {
    label: 'Treino de tiro (intervalado)',
    category: 'SPEED_POWER',
    kind: 'INTERVALS',
    intensity: 'HARD',
    stimulus:
      'Distâncias ou tempos curtos em intensidade elevada, intercalados com recuperação ativa ou passiva. Ex.: 6 × 400 m.',
    objective:
      'Desenvolver velocidade, capacidade aeróbia em intensidades altas e tolerância ao esforço intenso.',
    adaptation: 'Mais velocidade sustentável e menor custo do esforço intenso.',
    minLevel: 'INTERMEDIATE',
    phases: BUILD_PEAK,
    needsPaceAnchor: true,
    scope: 'RUNNING',
  },
  SHORT_SPRINTS: {
    label: 'Tiros curtos (sprints)',
    category: 'SPEED_POWER',
    kind: 'INTERVALS',
    intensity: 'NEUROMUSCULAR',
    stimulus:
      'Estímulos muito curtos em velocidade máxima ou próxima dela, com recuperação relativamente longa. Ex.: 6 × 100 m.',
    objective:
      'Desenvolver velocidade máxima, recrutamento neuromuscular, potência e capacidade de aceleração.',
    adaptation: 'Mais potência e aceleração, com pouca fadiga acumulada.',
    minLevel: 'INTERMEDIATE',
    phases: ALL_PHASES,
    needsPaceAnchor: false,
    caution: 'Aquecimento completo e recuperação ampla; é esforço máximo curto, não volume.',
    scope: 'RUNNING',
  },
  PROGRESSIVE_ACCELERATIONS: {
    label: 'Aceleração progressiva',
    category: 'SPEED_POWER',
    kind: 'EASY',
    intensity: 'NEUROMUSCULAR',
    stimulus:
      'Começa em velocidade baixa e aumenta gradualmente até uma velocidade elevada, ao longo de 80 a 150 m.',
    objective: 'Desenvolver controle de velocidade, coordenação, técnica e capacidade de acelerar.',
    adaptation: 'Melhor coordenação e transição para ritmos mais rápidos.',
    minLevel: 'BEGINNER',
    phases: ALL_PHASES,
    needsPaceAnchor: false,
    scope: 'RUNNING',
  },
  STRIDES: {
    label: 'Strides (retas)',
    category: 'SPEED_POWER',
    kind: 'EASY',
    intensity: 'NEUROMUSCULAR',
    stimulus:
      'Acelerações curtas e controladas, de 60 a 100 m, sem chegar à velocidade máxima, no fim de uma corrida leve.',
    objective:
      'Melhorar economia de movimento, coordenação, técnica e familiaridade com ritmos mais rápidos, sem grande fadiga.',
    adaptation: 'Passada mais eficiente e soltura em ritmos rápidos.',
    minLevel: 'BEGINNER',
    phases: ALL_PHASES,
    needsPaceAnchor: false,
    scope: 'RUNNING',
  },
  TOP_SPEED: {
    label: 'Velocidade máxima',
    category: 'SPEED_POWER',
    kind: 'INTERVALS',
    intensity: 'NEUROMUSCULAR',
    stimulus:
      'Estímulos muito curtos próximos da velocidade máxima individual, com recuperação ampla.',
    objective:
      'Desenvolver a capacidade de produzir altas velocidades e melhorar a eficiência neuromuscular.',
    adaptation: 'Teto de velocidade mais alto.',
    minLevel: 'ADVANCED',
    phases: ['BUILD', 'PEAK'],
    needsPaceAnchor: false,
    caution: 'Risco de lesão muscular se mal aquecido: só com base sólida e recuperação completa.',
    scope: 'RUNNING',
  },

  // --- 2. Limiar e resistência em ritmos elevados -----------------------------------------
  LACTATE_THRESHOLD: {
    label: 'Limiar de lactato',
    category: 'THRESHOLD',
    kind: 'THRESHOLD',
    intensity: 'HARD',
    stimulus:
      'Corrida sustentada ou intervalada próxima da intensidade do limiar de lactato (ritmo “confortavelmente difícil”).',
    objective: 'Melhorar a capacidade de sustentar ritmos elevados por períodos prolongados.',
    adaptation: 'Ritmo de limiar mais rápido: manter o ritmo forte por mais tempo.',
    minLevel: 'INTERMEDIATE',
    phases: BUILD_PEAK,
    needsPaceAnchor: true,
    scope: 'RUNNING',
  },
  TEMPO_RUN: {
    label: 'Tempo run (ritmo sustentado)',
    category: 'THRESHOLD',
    kind: 'TEMPO',
    intensity: 'HARD',
    stimulus:
      'Corrida contínua em intensidade moderadamente alta, próxima do limiar e ajustada ao nível do corredor, entre aquecimento e desaquecimento.',
    objective:
      'Desenvolver resistência em ritmos fortes e a capacidade de manter um esforço constante.',
    adaptation: 'Mais resistência em ritmo forte e melhor controle do esforço.',
    minLevel: 'BEGINNER',
    phases: BUILD_PEAK,
    needsPaceAnchor: false,
    caution: 'Iniciante: blocos curtos (10 a 15 min) por PSE 6–7.',
    scope: 'RUNNING',
  },
  CRUISE_INTERVALS: {
    label: 'Cruise intervals',
    category: 'THRESHOLD',
    kind: 'THRESHOLD',
    intensity: 'HARD',
    stimulus:
      'Intervalos de duração moderada ou longa, próximos do limiar, com recuperações curtas. Ex.: 4 × 8 min.',
    objective:
      'Acumular tempo de trabalho próximo ao limiar sem exigir um esforço contínuo muito prolongado.',
    adaptation: 'Mais volume total no limiar, com menos fadiga que o contínuo.',
    minLevel: 'INTERMEDIATE',
    phases: BUILD_PEAK,
    needsPaceAnchor: true,
    scope: 'RUNNING',
  },
  RACE_PACE_RUN: {
    label: 'Ritmo de prova',
    category: 'THRESHOLD',
    kind: 'TEMPO',
    intensity: 'HARD',
    stimulus: 'Sessão no ritmo planejado para uma competição específica.',
    objective:
      'Criar familiaridade fisiológica e psicológica com o ritmo-alvo e treinar a capacidade de sustentá-lo.',
    adaptation: 'Ritmo-alvo mais natural e mais fácil de sustentar.',
    minLevel: 'INTERMEDIATE',
    phases: ['BUILD', 'PEAK', 'TAPER'],
    needsPaceAnchor: true,
    scope: 'RUNNING',
  },
  STEADY_STATE: {
    label: 'Ritmo controlado (steady state)',
    category: 'THRESHOLD',
    kind: 'MODERATE',
    intensity: 'MODERATE',
    stimulus:
      'Corrida contínua em intensidade moderada, acima de um esforço fácil e abaixo da intensidade do limiar.',
    objective:
      'Desenvolver resistência aeróbia e a capacidade de sustentar esforços moderados por períodos prolongados.',
    adaptation: 'Mais resistência aeróbia em ritmo moderado.',
    minLevel: 'BEGINNER',
    phases: NOT_TAPER,
    needsPaceAnchor: false,
    scope: 'RUNNING',
  },

  // --- 3. Desenvolvimento aeróbio ---------------------------------------------------------
  RECOVERY_RUN: {
    label: 'Regenerativo',
    category: 'AEROBIC',
    kind: 'RECOVERY',
    intensity: 'EASY',
    stimulus: 'Corrida muito leve, de baixa exigência fisiológica e curta.',
    objective:
      'Promover recuperação ativa, manter a frequência de corrida e aumentar a consistência sem adicionar carga.',
    adaptation: 'Recuperação mais rápida entre sessões exigentes.',
    minLevel: 'BEGINNER',
    phases: ALL_PHASES,
    needsPaceAnchor: false,
    scope: 'RUNNING',
  },
  EASY_RUN: {
    label: 'Corrida leve (easy run)',
    category: 'AEROBIC',
    kind: 'EASY',
    intensity: 'EASY',
    stimulus: 'Corrida em baixa intensidade, esforço confortável e com possibilidade de conversar.',
    objective:
      'Desenvolver a base aeróbia, aumentar a capacidade de acumular volume e favorecer a recuperação entre sessões exigentes.',
    adaptation: 'Base aeróbia maior e mais volume tolerado.',
    minLevel: 'BEGINNER',
    phases: ALL_PHASES,
    needsPaceAnchor: false,
    scope: 'RUNNING',
  },
  MODERATE_CONTINUOUS: {
    label: 'Contínuo moderado',
    category: 'AEROBIC',
    kind: 'MODERATE',
    intensity: 'MODERATE',
    stimulus: 'Corrida contínua em intensidade aeróbia moderada, mais exigente que a leve.',
    objective:
      'Melhorar a resistência aeróbia e a capacidade de sustentar esforços por mais tempo.',
    adaptation: 'Mais resistência aeróbia.',
    minLevel: 'BEGINNER',
    phases: NOT_TAPER,
    needsPaceAnchor: false,
    scope: 'RUNNING',
  },
  LONG_RUN: {
    label: 'Longão (long run)',
    category: 'AEROBIC',
    kind: 'LONG',
    intensity: 'EASY',
    stimulus:
      'Corrida de duração ou distância superior à habitual, em intensidade predominantemente fácil.',
    objective:
      'Desenvolver resistência, tolerância ao tempo prolongado de exercício e preparação específica para provas longas.',
    adaptation: 'Mais resistência e tolerância ao tempo em pé correndo.',
    minLevel: 'BEGINNER',
    phases: ['BASE', 'BUILD', 'PEAK', 'MAINTENANCE'],
    needsPaceAnchor: false,
    scope: 'RUNNING',
  },
  PROGRESSIVE_LONG_RUN: {
    label: 'Longão progressivo',
    category: 'AEROBIC',
    kind: 'LONG',
    intensity: 'MODERATE',
    stimulus:
      'Corrida longa em que a intensidade ou o ritmo aumenta gradualmente ao longo da sessão.',
    objective:
      'Desenvolver resistência à fadiga e capacidade de acelerar depois de acumular tempo de exercício.',
    adaptation: 'Rendimento mais estável no fim das corridas longas.',
    minLevel: 'BEGINNER',
    phases: ['BASE', 'BUILD', 'PEAK', 'MAINTENANCE'],
    needsPaceAnchor: false,
    scope: 'RUNNING',
  },
  FAST_FINISH_LONG_RUN: {
    label: 'Longão com final forte',
    category: 'AEROBIC',
    kind: 'LONG',
    intensity: 'MODERATE',
    stimulus:
      'Corrida longa predominantemente leve, com os minutos finais em intensidade moderada ou próxima do ritmo de prova.',
    objective: 'Desenvolver a capacidade de sustentar ritmos mais elevados sob fadiga.',
    adaptation: 'Ritmo forte mantido mesmo cansado.',
    minLevel: 'INTERMEDIATE',
    phases: ['BUILD', 'PEAK'],
    needsPaceAnchor: false,
    scope: 'RUNNING',
  },

  // --- 4. Intervalados e variações de estímulo --------------------------------------------
  AEROBIC_INTERVALS: {
    label: 'Intervalado aeróbio',
    category: 'INTERVALS',
    kind: 'INTERVALS',
    intensity: 'HARD',
    stimulus:
      'Alternância entre períodos de corrida em intensidade aeróbia moderada ou elevada e períodos de recuperação. Ex.: 5 × 3 min.',
    objective: 'Desenvolver capacidade aeróbia e acumular tempo em intensidades específicas.',
    adaptation: 'Mais capacidade aeróbia com menos fadiga que o contínuo.',
    minLevel: 'BEGINNER',
    phases: BASE_BUILD,
    needsPaceAnchor: false,
    caution: 'Iniciante: repetições curtas (1 a 3 min) por PSE 6–7 e recuperação em trote.',
    scope: 'RUNNING',
  },
  VO2MAX_INTERVALS: {
    label: 'Intervalado de VO₂máx',
    category: 'INTERVALS',
    kind: 'INTERVALS',
    intensity: 'HARD',
    stimulus:
      'Intervalos intensos, com duração suficiente para gerar elevada demanda aeróbia, intercalados por recuperações. Ex.: 5 × 3 min.',
    objective: 'Melhorar a capacidade máxima de utilização de oxigênio.',
    adaptation: 'Teto aeróbio mais alto (VO₂máx).',
    minLevel: 'INTERMEDIATE',
    phases: ['BUILD', 'PEAK'],
    needsPaceAnchor: true,
    scope: 'RUNNING',
  },
  RUNNING_HIIT: {
    label: 'HIIT de corrida',
    category: 'INTERVALS',
    kind: 'INTERVALS',
    intensity: 'HARD',
    stimulus:
      'Estímulos intensos alternados com períodos de recuperação, em estrutura variável de duração e intensidade.',
    objective: 'Desenvolver condicionamento cardiorrespiratório e tolerância a esforços intensos.',
    adaptation: 'Mais condicionamento em pouco tempo.',
    minLevel: 'INTERMEDIATE',
    phases: ['BUILD', 'PEAK', 'MAINTENANCE'],
    needsPaceAnchor: false,
    scope: 'RUNNING',
  },
  FARTLEK: {
    label: 'Fartlek',
    category: 'INTERVALS',
    kind: 'FARTLEK',
    intensity: 'HARD',
    stimulus:
      'Alternância de velocidades e intensidades durante a corrida, estruturada ou espontânea, sem distâncias fixas. Ex.: 1 min rápido / 2 min leves.',
    objective:
      'Desenvolver a capacidade de mudar de ritmo, a resistência e a adaptação a diferentes intensidades.',
    adaptation:
      'Mais flexibilidade de ritmo e resistência, com a porta de entrada mais amigável da qualidade.',
    minLevel: 'BEGINNER',
    phases: ['BASE', 'BUILD', 'PEAK', 'MAINTENANCE'],
    needsPaceAnchor: false,
    scope: 'RUNNING',
  },
  VARIABLE_INTERVALS: {
    label: 'Intervalado variável',
    category: 'INTERVALS',
    kind: 'INTERVALS',
    intensity: 'HARD',
    stimulus:
      'Alternância planejada entre diferentes ritmos, durações e intensidades, com recuperação variável.',
    objective:
      'Desenvolver versatilidade fisiológica e a capacidade de responder a diferentes demandas de ritmo.',
    adaptation: 'Resposta melhor a mudanças de ritmo.',
    minLevel: 'INTERMEDIATE',
    phases: BUILD_PEAK,
    needsPaceAnchor: true,
    scope: 'RUNNING',
  },
  REPETITION_TRAINING: {
    label: 'Treino de repetição',
    category: 'INTERVALS',
    kind: 'INTERVALS',
    intensity: 'HARD',
    stimulus: 'Repetições curtas ou moderadas em velocidade elevada, com recuperação ampla.',
    objective: 'Desenvolver velocidade, economia de corrida e qualidade técnica em ritmos rápidos.',
    adaptation: 'Economia de corrida e velocidade em ritmo rápido.',
    minLevel: 'ADVANCED',
    phases: ['BUILD', 'PEAK'],
    needsPaceAnchor: true,
    scope: 'RUNNING',
  },

  // --- 5. Terrenos e condições específicas ------------------------------------------------
  HILL_REPEATS: {
    label: 'Treino de subida (hill repeats)',
    category: 'TERRAIN',
    kind: 'HILLS',
    intensity: 'HARD',
    stimulus: 'Repetições em aclive, com recuperação na descida ou no plano.',
    objective:
      'Desenvolver força específica de corrida, potência, capacidade cardiorrespiratória e resistência muscular.',
    adaptation: 'Mais força e potência de passada, com baixo impacto relativo.',
    minLevel: 'BEGINNER',
    phases: ['BASE', 'BUILD', 'PEAK', 'MAINTENANCE'],
    terrain: 'HILLS',
    needsPaceAnchor: false,
    caution: 'Iniciante: subidas curtas (20 a 40 s) por PSE; recuperação descendo caminhando.',
    scope: 'RUNNING',
  },
  CONTINUOUS_UPHILL: {
    label: 'Contínuo em subida',
    category: 'TERRAIN',
    kind: 'HILLS',
    intensity: 'HARD',
    stimulus: 'Corrida prolongada em percurso inclinado.',
    objective:
      'Desenvolver resistência muscular e capacidade aeróbia sob maior exigência mecânica.',
    adaptation: 'Mais resistência muscular nas pernas.',
    minLevel: 'INTERMEDIATE',
    phases: ['BASE', 'BUILD', 'PEAK', 'MAINTENANCE'],
    terrain: 'HILLS',
    needsPaceAnchor: false,
    scope: 'RUNNING',
  },
  DOWNHILL_RUN: {
    label: 'Treino de descida',
    category: 'TERRAIN',
    kind: 'HILLS',
    intensity: 'MODERATE',
    stimulus: 'Corrida em declives, com controle de velocidade e técnica.',
    objective:
      'Desenvolver habilidade técnica, coordenação e tolerância às demandas excêntricas da descida.',
    adaptation: 'Descidas mais seguras e musculatura mais tolerante.',
    minLevel: 'ADVANCED',
    phases: ['BUILD', 'PEAK'],
    terrain: 'HILLS',
    needsPaceAnchor: false,
    caution:
      'Alta carga muscular excêntrica: pouco volume e longe de provas e de sessões intensas.',
    scope: 'RUNNING',
  },
  TRAIL_RUN: {
    label: 'Corrida em trilha (trail run)',
    category: 'TERRAIN',
    kind: 'MODERATE',
    intensity: 'MODERATE',
    stimulus: 'Corrida em terreno natural irregular, com variação de inclinação e superfície.',
    objective:
      'Desenvolver resistência, propriocepção, equilíbrio, força específica e adaptação a terrenos variados.',
    adaptation: 'Mais estabilidade e força de tornozelo e quadril.',
    minLevel: 'BEGINNER',
    phases: NOT_TAPER,
    terrain: 'TRAIL',
    needsPaceAnchor: false,
    scope: 'RUNNING',
  },
  SAND_RUN: {
    label: 'Corrida na areia',
    category: 'TERRAIN',
    kind: 'MODERATE',
    intensity: 'MODERATE',
    stimulus: 'Corrida em superfície de areia, que aumenta a demanda muscular e altera a mecânica.',
    objective: 'Desenvolver resistência muscular e adaptação a superfícies instáveis.',
    adaptation: 'Mais resistência muscular, sem impacto alto.',
    minLevel: 'INTERMEDIATE',
    phases: ['BASE', 'BUILD', 'MAINTENANCE'],
    terrain: 'SAND',
    needsPaceAnchor: false,
    caution: 'Não substitui o treino convencional; começar com pouco tempo.',
    scope: 'RUNNING',
  },
  TREADMILL_RUN: {
    label: 'Corrida na esteira',
    category: 'TERRAIN',
    kind: 'EASY',
    intensity: 'EASY',
    stimulus: 'Corrida em esteira, com velocidade e inclinação controladas.',
    objective: 'Executar estímulos específicos com mais controle das condições externas.',
    adaptation: 'Ritmo mais preciso e treino possível com chuva ou sem rua segura.',
    minLevel: 'BEGINNER',
    phases: ALL_PHASES,
    terrain: 'TREADMILL',
    needsPaceAnchor: false,
    scope: 'RUNNING',
  },

  // --- 6. Técnica e neuromuscular ---------------------------------------------------------
  RUNNING_DRILLS: {
    label: 'Técnica de corrida (drills)',
    category: 'TECHNIQUE',
    kind: 'EASY',
    intensity: 'EASY',
    stimulus:
      'Exercícios de coordenação e mecânica, como skipping, elevação de joelhos e dribbling, em corrida leve.',
    objective: 'Desenvolver coordenação, controle motor e consciência corporal.',
    adaptation: 'Melhor coordenação (não garante, sozinho, melhora de desempenho).',
    minLevel: 'BEGINNER',
    phases: ALL_PHASES,
    needsPaceAnchor: false,
    scope: 'RUNNING',
  },
  COORDINATION: {
    label: 'Coordenação',
    category: 'TECHNIQUE',
    kind: 'EASY',
    intensity: 'EASY',
    stimulus:
      'Exercícios que trabalham ritmo, sincronização e controle dos movimentos, em corrida leve.',
    objective: 'Melhorar a organização neuromuscular da corrida.',
    adaptation: 'Passada mais organizada.',
    minLevel: 'BEGINNER',
    phases: ALL_PHASES,
    needsPaceAnchor: false,
    scope: 'RUNNING',
  },
  CADENCE: {
    label: 'Cadência',
    category: 'TECHNIQUE',
    kind: 'EASY',
    intensity: 'EASY',
    stimulus:
      'Corrida leve com atenção à frequência de passadas, com metrônomo ou outra referência.',
    objective:
      'Desenvolver controle do ritmo de passada e explorar ajustes individuais de técnica.',
    adaptation: 'Controle da passada. Não existe cadência ideal universal.',
    minLevel: 'BEGINNER',
    phases: ALL_PHASES,
    needsPaceAnchor: false,
    scope: 'RUNNING',
  },
  RUNNING_ECONOMY: {
    label: 'Economia de corrida',
    category: 'TECHNIQUE',
    kind: 'EASY',
    intensity: 'NEUROMUSCULAR',
    stimulus: 'Corrida leve combinada com técnica, strides e estímulos específicos de força.',
    objective: 'Correr em determinada velocidade com menor custo fisiológico.',
    adaptation: 'Mesma velocidade com menos esforço.',
    minLevel: 'BEGINNER',
    phases: ALL_PHASES,
    needsPaceAnchor: false,
    scope: 'RUNNING',
  },

  // --- 7. Provas e competição -------------------------------------------------------------
  RACE_SIMULATION: {
    label: 'Treino simulado de prova',
    category: 'RACE_SPECIFIC',
    kind: 'RACE',
    intensity: 'HARD',
    stimulus:
      'Reproduz parcialmente a competição: ritmo, distância, alimentação, hidratação e estratégia.',
    objective: 'Testar a preparação e identificar ajustes necessários antes da prova.',
    adaptation: 'Confiança e estratégia testadas.',
    minLevel: 'INTERMEDIATE',
    phases: ['PEAK'],
    needsPaceAnchor: true,
    caution: 'Só com prova marcada; no máximo uma por ciclo.',
    scope: 'RUNNING',
  },
  RACE_PACE_REPEATS: {
    label: 'Ritmo de prova fracionado',
    category: 'RACE_SPECIFIC',
    kind: 'THRESHOLD',
    intensity: 'HARD',
    stimulus: 'Blocos no ritmo-alvo da prova, intercalados com recuperação.',
    objective: 'Acumular volume no ritmo competitivo sem uma distância contínua muito longa.',
    adaptation: 'Mais tempo no ritmo de prova, com menos desgaste.',
    minLevel: 'INTERMEDIATE',
    phases: ['BUILD', 'PEAK', 'TAPER'],
    needsPaceAnchor: true,
    scope: 'RUNNING',
  },
  NEGATIVE_SPLIT: {
    label: 'Negative split',
    category: 'RACE_SPECIFIC',
    kind: 'PROGRESSIVE',
    intensity: 'MODERATE',
    stimulus: 'A segunda metade da corrida é feita em ritmo mais rápido que a primeira.',
    objective: 'Desenvolver controle de esforço e estratégia de distribuição de ritmo.',
    adaptation: 'Distribuição de esforço melhor e final de prova mais forte.',
    minLevel: 'BEGINNER',
    phases: BUILD_PEAK,
    needsPaceAnchor: false,
    scope: 'RUNNING',
  },
  POSITIVE_SPLIT: {
    label: 'Positive split',
    category: 'RACE_SPECIFIC',
    kind: 'MODERATE',
    intensity: 'MODERATE',
    stimulus: 'A primeira metade da corrida é mais rápida que a segunda.',
    objective: 'Estudar estratégia de distribuição em situações específicas.',
    adaptation: 'Aprendizado de ritmo. Não costuma ser a estratégia preferencial.',
    minLevel: 'ADVANCED',
    phases: ['PEAK'],
    needsPaceAnchor: true,
    caution: 'Uso pontual para estudo de estratégia; prefira o negative split.',
    scope: 'RUNNING',
  },
  PACING: {
    label: 'Pacing (controle de ritmo)',
    category: 'RACE_SPECIFIC',
    kind: 'MODERATE',
    intensity: 'MODERATE',
    stimulus:
      'Corrida voltada ao controle e à percepção do ritmo, evitando oscilações desnecessárias.',
    objective: 'Melhorar a capacidade de distribuir o esforço durante uma prova.',
    adaptation: 'Percepção de ritmo mais precisa.',
    minLevel: 'BEGINNER',
    phases: ALL_PHASES,
    needsPaceAnchor: false,
    scope: 'RUNNING',
  },
  HYROX_TRANSITION: {
    label: 'Transição para prova híbrida (HYROX)',
    category: 'RACE_SPECIFIC',
    kind: 'INTERVALS',
    intensity: 'HARD',
    stimulus:
      'Alternância entre corrida e estações funcionais, simulando as demandas de uma competição híbrida.',
    objective:
      'Desenvolver a capacidade de correr após exercícios que geram fadiga muscular e cardiorrespiratória.',
    adaptation: 'Corrida mais estável sob fadiga.',
    minLevel: 'INTERMEDIATE',
    phases: ['BUILD', 'PEAK'],
    needsPaceAnchor: false,
    caution: 'É sessão do bloco de HYROX (correndo comprometido), não do bloco de corrida.',
    scope: 'HYROX',
  },
};

const LEVEL_ORDER: Readonly<Record<RunningWorkoutLevel, number>> = {
  BEGINNER: 0,
  INTERMEDIATE: 1,
  ADVANCED: 2,
};

export const RUNNING_WORKOUT_TYPES = runningWorkoutTypeSchema.options;

export const RUNNING_WORKOUT_LABELS: Readonly<Record<RunningWorkoutType, string>> =
  Object.fromEntries(
    RUNNING_WORKOUT_TYPES.map((type) => [type, RUNNING_WORKOUTS[type].label]),
  ) as Record<RunningWorkoutType, string>;

/** Nome do treino para o aluno: o específico do catálogo ou, em plano antigo, o da classe. */
export function runningSessionLabel(content: {
  kind: RunningSessionKind;
  workoutType?: RunningWorkoutType;
}): string {
  return content.workoutType
    ? RUNNING_WORKOUT_LABELS[content.workoutType]
    : RUNNING_SESSION_KIND_LABELS[content.kind];
}

/**
 * Treinos que o treinador de corrida pode usar: do escopo de corrida, do nível do aluno (ou
 * abaixo) e da fase da preparação.
 */
export function eligibleRunningWorkouts(input: {
  level: RunningWorkoutLevel;
  phase: RunningPhase;
}): RunningWorkoutType[] {
  return RUNNING_WORKOUT_TYPES.filter((type) => {
    const spec = RUNNING_WORKOUTS[type];
    return (
      spec.scope === 'RUNNING' &&
      LEVEL_ORDER[spec.minLevel] <= LEVEL_ORDER[input.level] &&
      spec.phases.includes(input.phase)
    );
  });
}
