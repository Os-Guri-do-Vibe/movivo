/**
 * Os documentos de metodologia da MOVIVO, um por domínio. Escritos pelos profissionais no
 * estúdio (painel interno), versionados e testados contra os casos de avaliação antes de
 * publicar. Os agentes recebem a versão PUBLICADA renderizada no prompt.
 *
 * Os exemplos são só ponto de partida de um rascunho — quem decide os valores é o profissional.
 */
import { z } from 'zod';

import {
  coachingActionTypeSchema,
  safetySignalKindSchema,
  type CoachingActionType,
  type SafetySignalKind,
} from '../coaching/coaching.schema';
import { hyroxStationSchema, HYROX_STATION_LABELS } from '../training/endurance.schema';
import type { DomainSpec } from './fields';

const LEVELS = [
  { key: 'BEGINNER', label: 'Iniciante' },
  { key: 'INTERMEDIATE', label: 'Intermediário' },
  { key: 'ADVANCED', label: 'Avançado' },
] as const;

const AUTONOMY_LEVEL_OPTIONS = [
  { value: 'AUTO', label: 'Automático' },
  { value: 'AUTO_WITH_LIMITS', label: 'Automático dentro do limite' },
  { value: 'ASK', label: 'Perguntar ao aluno' },
  { value: 'ESCALATE', label: 'Encaminhar à equipe' },
] as const;

/** Rótulos das ações no documento de autonomia (com a unidade do limite, quando há). */
export const AUTONOMY_ACTION_LABELS: Readonly<Record<CoachingActionType, string>> = {
  RESCHEDULE_WEEK: 'Reorganizar a semana (limite: sessões deixadas de fora)',
  SUBSTITUTE_EXERCISE: 'Trocar exercício por equivalente do catálogo',
  SHORTEN_SESSION: 'Encurtar a sessão do dia (limite: % máximo de redução)',
  ADJUST_WEEKLY_VOLUME: 'Ajustar volume semanal (limite: % de variação)',
  PUBLISH_TRAINING_PLAN: 'Publicar nova versão do plano de treino',
  PUBLISH_NUTRITION_PLAN: 'Publicar nova versão do plano alimentar',
  ADJUST_ENERGY_TARGET: 'Ajustar meta de energia (limite: kcal/dia)',
  ADJUST_MEAL_GUIDANCE: 'Ajustar orientação de uma refeição',
  DEFINE_STRATEGY: 'Definir a estratégia do objetivo',
  RECORD_PREFERENCE: 'Registrar preferência do aluno',
  RECORD_CONSTRAINT: 'Registrar restrição/disponibilidade',
  SEND_MESSAGE: 'Enviar mensagem',
  ASK_STUDENT: 'Fazer pergunta ao aluno',
};

/** Rótulos dos sinais de segurança. */
export const SAFETY_SIGNAL_LABELS: Readonly<Record<SafetySignalKind, string>> = {
  PARQ_POSITIVE: 'PAR-Q com resposta de risco',
  CHEST_PAIN: 'Dor no peito',
  FAINTING_OR_DIZZINESS: 'Desmaio ou tontura',
  SHORTNESS_OF_BREATH: 'Falta de ar fora do esperado',
  SEVERE_PAIN: 'Dor forte',
  PERSISTENT_PAIN: 'Dor persistente',
  NEW_INJURY: 'Lesão nova',
  MEDICATION_CHANGE: 'Mudança de medicação',
  PREGNANCY: 'Gestação',
  RECENT_SURGERY: 'Cirurgia recente',
  EATING_DISORDER_SIGNS: 'Sinais de transtorno alimentar',
  RAPID_WEIGHT_CHANGE: 'Mudança rápida de peso',
  MENTAL_DISTRESS: 'Sofrimento emocional',
  OTHER: 'Outro',
};

const STRENGTH: DomainSpec = {
  domain: 'STRENGTH',
  title: 'Musculação e força',
  description:
    'Como a MOVIVO prescreve e progride o treino de força: volume, intensidade de esforço, frequência, descanso, periodização e escolha de exercícios.',
  owner: 'CREF',
  sections: [
    {
      key: 'volume',
      title: 'Volume',
      description: 'Séries efetivas (perto da falha) por grupo muscular.',
      fields: {
        weeklySets: {
          kind: 'table',
          label: 'Séries por grupo muscular por semana',
          hint: 'Faixa de séries efetivas por grupo muscular na semana, por nível. Comece pelo piso e suba conforme a recuperação observada.',
          reference: 'Schoenfeld et al., 2017; ACSM Position Stand 2026',
          rows: LEVELS,
          columns: {
            sets: {
              kind: 'range',
              label: 'Séries/semana',
              hint: 'Mínimo e máximo semanal.',
              unit: 'séries',
              min: 0,
              max: 40,
              plausible: [4, 25],
              example: { min: 10, max: 16 },
            },
          },
        },
        maxSetsPerMusclePerSession: {
          kind: 'number',
          label: 'Teto de séries por grupo numa sessão',
          hint: 'Acima disso o retorno por sessão cai e a fadiga sobe: distribua o volume em mais dias.',
          unit: 'séries',
          min: 2,
          max: 20,
          plausible: [4, 12],
          example: 10,
        },
        minFrequencyPerMuscle: {
          kind: 'number',
          label: 'Frequência mínima por grupo muscular',
          hint: 'Vezes por semana que cada grupo é treinado, sempre que a disponibilidade permitir.',
          unit: 'x/semana',
          min: 1,
          max: 4,
          plausible: [1, 3],
          example: 2,
        },
      },
    },
    {
      key: 'intensity',
      title: 'Intensidade e repetições',
      description: 'Proximidade da falha (RIR) e faixas de repetição por objetivo.',
      fields: {
        rirByPhase: {
          kind: 'table',
          label: 'Repetições em reserva por fase',
          hint: 'RIR das séries de trabalho. 0 = falha concêntrica. Iniciantes ficam mais longe da falha.',
          rows: [
            { key: 'ADAPTATION', label: 'Adaptação' },
            { key: 'HYPERTROPHY', label: 'Hipertrofia' },
            { key: 'STRENGTH', label: 'Força' },
            { key: 'DELOAD', label: 'Recuperação' },
          ],
          columns: {
            rir: {
              kind: 'range',
              label: 'RIR',
              hint: 'Mínimo e máximo.',
              min: 0,
              max: 6,
              plausible: [0, 5],
              example: { min: 1, max: 3 },
            },
          },
        },
        repsByGoal: {
          kind: 'table',
          label: 'Repetições por objetivo',
          hint: 'Faixa de repetições das séries de trabalho nos exercícios principais.',
          rows: [
            { key: 'HYPERTROPHY', label: 'Hipertrofia' },
            { key: 'STRENGTH', label: 'Força máxima' },
            { key: 'MUSCULAR_ENDURANCE', label: 'Resistência muscular' },
          ],
          columns: {
            reps: {
              kind: 'range',
              label: 'Repetições',
              hint: 'Mínimo e máximo.',
              min: 1,
              max: 50,
              plausible: [1, 30],
              example: { min: 6, max: 12 },
            },
          },
        },
        restSeconds: {
          kind: 'table',
          label: 'Descanso entre séries',
          hint: 'Descanso curto demais em multiarticulares pesados reduz o volume de qualidade.',
          rows: [
            { key: 'COMPOUND', label: 'Multiarticular' },
            { key: 'ISOLATION', label: 'Isolado' },
            { key: 'STRENGTH_MAIN', label: 'Principal de força' },
          ],
          columns: {
            seconds: {
              kind: 'range',
              label: 'Segundos',
              hint: 'Mínimo e máximo.',
              unit: 's',
              min: 15,
              max: 600,
              plausible: [30, 300],
              example: { min: 90, max: 150 },
            },
          },
        },
      },
    },
    {
      key: 'periodization',
      title: 'Periodização e progressão',
      description: 'Duração dos blocos, recuperação programada e como progredir.',
      fields: {
        mesocycleWeeks: {
          kind: 'range',
          label: 'Duração de um bloco',
          hint: 'Semanas de um mesociclo antes de reavaliar.',
          unit: 'semanas',
          min: 2,
          max: 12,
          plausible: [3, 8],
          example: { min: 4, max: 6 },
        },
        deloadEveryWeeks: {
          kind: 'table',
          label: 'Semana de recuperação a cada',
          hint: 'Avançados costumam precisar de recuperação mais frequente.',
          rows: LEVELS,
          columns: {
            weeks: {
              kind: 'number',
              label: 'Semanas',
              hint: 'Intervalo entre recuperações.',
              unit: 'semanas',
              min: 2,
              max: 12,
              plausible: [3, 8],
              example: 5,
            },
          },
        },
        deloadVolumeReductionPct: {
          kind: 'number',
          label: 'Redução de volume na recuperação',
          hint: 'Mantém frequência e exercícios; reduz séries.',
          unit: '%',
          min: 10,
          max: 80,
          plausible: [30, 60],
          example: 40,
        },
        progressionMethod: {
          kind: 'choice',
          label: 'Método de progressão padrão',
          hint: 'Como a carga sobe quando o aluno alcança o topo da faixa de repetições.',
          options: [
            { value: 'DOUBLE_PROGRESSION', label: 'Dupla progressão (reps, depois carga)' },
            { value: 'RIR_BASED', label: 'Por RIR (autorregulação)' },
            { value: 'LINEAR', label: 'Linear (carga fixa por sessão)' },
          ],
          example: 'DOUBLE_PROGRESSION',
        },
        loadIncrementKg: {
          kind: 'table',
          label: 'Incremento de carga',
          hint: 'Quanto subir quando a progressão manda subir carga.',
          rows: [
            { key: 'UPPER', label: 'Membros superiores' },
            { key: 'LOWER', label: 'Membros inferiores' },
          ],
          columns: {
            kg: {
              kind: 'range',
              label: 'kg',
              hint: 'Mínimo e máximo.',
              unit: 'kg',
              min: 0.5,
              max: 20,
              plausible: [1, 10],
              example: { min: 1, max: 2.5 },
            },
          },
        },
      },
    },
    {
      key: 'structure',
      title: 'Estrutura da sessão',
      description: 'Divisões permitidas, duração e escolha de exercícios.',
      fields: {
        allowedSplits: {
          kind: 'table',
          label: 'Divisões permitidas por nível',
          hint: 'A divisão é escolha de logística e adesão: volume semanal igualado dá resultado parecido.',
          rows: LEVELS,
          columns: {
            fullBody: { kind: 'boolean', label: 'Full body', hint: '', example: true },
            upperLower: { kind: 'boolean', label: 'Superior/inferior', hint: '', example: true },
            pushPullLegs: { kind: 'boolean', label: 'Push/pull/legs', hint: '', example: true },
            bodyPart: { kind: 'boolean', label: 'Por grupo muscular', hint: '', example: false },
          },
        },
        maxExercisesPerSession: {
          kind: 'number',
          label: 'Máximo de exercícios por sessão',
          hint: 'Conte aquecimento específico à parte.',
          min: 3,
          max: 15,
          plausible: [4, 10],
          example: 7,
        },
        compoundFirst: {
          kind: 'boolean',
          label: 'Multiarticulares no início da sessão',
          hint: 'Exercícios principais com o aluno descansado.',
          example: true,
        },
      },
    },
  ],
  guidance: [
    {
      key: 'principles',
      title: 'Princípios',
      hint: 'Como a MOVIVO pensa o treino de força: o que é inegociável e o que se adapta.',
    },
    {
      key: 'exerciseSelection',
      title: 'Escolha de exercícios',
      hint: 'Padrões de movimento como esqueleto, equipamento como detalhe; quando usar máquina, peso livre ou peso corporal.',
    },
    {
      key: 'substitutions',
      title: 'Substituições',
      hint: 'O que preservar ao trocar um exercício (padrão, grupo, amplitude, perfil de resistência).',
    },
    {
      key: 'specialPopulations',
      title: 'Casos especiais',
      hint: 'Iniciante absoluto, retorno após pausa, idade mais avançada, treino em casa.',
    },
  ],
};

const RUNNING: DomainSpec = {
  domain: 'RUNNING',
  title: 'Corrida',
  description:
    'Distribuição de intensidade, progressão de volume, longão, sessões de qualidade, zonas e retorno após pausa.',
  owner: 'CREF',
  sections: [
    {
      key: 'distribution',
      title: 'Distribuição de intensidade',
      description: 'Quanto do volume fica leve e quantas sessões de qualidade cabem.',
      fields: {
        easySharePct: {
          kind: 'table',
          label: 'Parte do volume em intensidade leve',
          hint: 'Percentual do tempo/distância semanal em Z1–Z2.',
          reference: 'Seiler, 2010; Stöggl & Sperlich, 2014',
          rows: LEVELS,
          columns: {
            pct: {
              kind: 'number',
              label: '%',
              hint: '',
              unit: '%',
              min: 50,
              max: 100,
              plausible: [65, 90],
              example: 80,
            },
          },
        },
        qualitySessionsPerWeek: {
          kind: 'table',
          label: 'Sessões de qualidade por semana',
          hint: 'Intervalado, limiar, ritmo de prova.',
          rows: LEVELS,
          columns: {
            max: {
              kind: 'number',
              label: 'Máximo',
              hint: '',
              min: 0,
              max: 4,
              plausible: [0, 3],
              example: 2,
            },
          },
        },
        minEasyDaysBetweenQuality: {
          kind: 'number',
          label: 'Dias leves entre sessões de qualidade',
          hint: 'Recuperação mínima entre dois estímulos intensos de corrida.',
          unit: 'dias',
          min: 0,
          max: 3,
          plausible: [1, 2],
          example: 1,
        },
      },
    },
    {
      key: 'progression',
      title: 'Progressão de volume',
      description: 'Quanto o volume e o longão podem crescer.',
      fields: {
        weeklyIncreaseMaxPct: {
          kind: 'number',
          label: 'Aumento máximo de volume semanal',
          hint: 'Em relação à média das últimas semanas.',
          unit: '%',
          min: 0,
          max: 30,
          plausible: [5, 15],
          example: 10,
        },
        longRunMaxSharePct: {
          kind: 'number',
          label: 'Longão: máximo do volume semanal',
          hint: 'Fração do volume da semana concentrada no longão.',
          unit: '%',
          min: 10,
          max: 60,
          plausible: [20, 40],
          example: 30,
        },
        longRunMaxMinutes: {
          kind: 'table',
          label: 'Duração máxima do longão',
          hint: 'Fora de preparação específica para maratona.',
          rows: LEVELS,
          columns: {
            minutes: {
              kind: 'number',
              label: 'Minutos',
              hint: '',
              unit: 'min',
              min: 20,
              max: 240,
              plausible: [40, 180],
              example: 90,
            },
          },
        },
        returnAfterBreakReductionPct: {
          kind: 'number',
          label: 'Redução ao voltar de pausa de 2+ semanas',
          hint: 'Volume da primeira semana de retorno em relação ao anterior à pausa.',
          unit: '%',
          min: 10,
          max: 90,
          plausible: [30, 60],
          example: 50,
        },
      },
    },
    {
      key: 'zones',
      title: 'Zonas',
      description: 'Como as zonas de intensidade são definidas.',
      fields: {
        method: {
          kind: 'choice',
          label: 'Método de zonas',
          hint: 'Use o que o aluno consegue medir. Sem relógio, PSE.',
          options: [
            { value: 'HR_MAX', label: '% da FC máxima' },
            { value: 'HR_RESERVE', label: '% da FC de reserva' },
            { value: 'PACE_FROM_5K', label: 'Ritmo a partir do 5 km' },
            { value: 'RPE', label: 'Percepção de esforço' },
          ],
          example: 'HR_MAX',
        },
        zoneBoundsPctHrMax: {
          kind: 'table',
          label: 'Limites das zonas (% FC máx)',
          hint: 'Usado quando o método é % da FC máxima.',
          rows: [
            { key: 'Z1', label: 'Z1' },
            { key: 'Z2', label: 'Z2' },
            { key: 'Z3', label: 'Z3' },
            { key: 'Z4', label: 'Z4' },
            { key: 'Z5', label: 'Z5' },
          ],
          columns: {
            pct: {
              kind: 'range',
              label: '% FC máx',
              hint: '',
              unit: '%',
              min: 40,
              max: 100,
              example: { min: 60, max: 70 },
            },
          },
        },
      },
    },
  ],
  guidance: [
    {
      key: 'principles',
      title: 'Princípios',
      hint: 'Consistência antes de intensidade; como a MOVIVO pensa a base aeróbica.',
    },
    {
      key: 'raceBlocks',
      title: 'Preparação para provas',
      hint: 'Estrutura por distância (5 km a maratona), polimento e semana de prova.',
    },
    {
      key: 'injuryPrevention',
      title: 'Prevenção de lesões',
      hint: 'Sinais de sobrecarga, superfície, calçado, força complementar.',
    },
  ],
};

const HYROX: DomainSpec = {
  domain: 'HYROX',
  title: 'HYROX',
  description:
    'Proporção entre corrida, estações e força por fase, simulados, corrida comprometida e cargas por categoria.',
  owner: 'CREF',
  sections: [
    {
      key: 'phases',
      title: 'Fases da preparação',
      description: 'Divisão do tempo de treino por fase.',
      fields: {
        mixByPhase: {
          kind: 'table',
          label: 'Mistura por fase',
          hint: 'Percentuais aproximados do tempo de treino semanal. Somam ~100%.',
          rows: [
            { key: 'BASE', label: 'Base' },
            { key: 'BUILD', label: 'Construção' },
            { key: 'PEAK', label: 'Específica' },
            { key: 'TAPER', label: 'Polimento' },
          ],
          columns: {
            runningPct: {
              kind: 'number',
              label: 'Corrida %',
              hint: '',
              unit: '%',
              min: 0,
              max: 100,
              example: 45,
            },
            stationsPct: {
              kind: 'number',
              label: 'Estações %',
              hint: '',
              unit: '%',
              min: 0,
              max: 100,
              example: 30,
            },
            strengthPct: {
              kind: 'number',
              label: 'Força %',
              hint: '',
              unit: '%',
              min: 0,
              max: 100,
              example: 25,
            },
          },
        },
        simulationEveryWeeks: {
          kind: 'number',
          label: 'Simulado a cada',
          hint: 'Simulado completo ou parcial em ritmo de prova.',
          unit: 'semanas',
          min: 1,
          max: 12,
          plausible: [2, 6],
          example: 4,
        },
        compromisedRunningPerWeek: {
          kind: 'number',
          label: 'Sessões de corrida comprometida por semana',
          hint: 'Correr logo após estação, como na prova.',
          min: 0,
          max: 4,
          plausible: [1, 3],
          example: 1,
        },
        taperWeeks: {
          kind: 'number',
          label: 'Semanas de polimento',
          hint: 'Redução de volume antes da prova mantendo intensidade.',
          unit: 'semanas',
          min: 0,
          max: 3,
          plausible: [1, 2],
          example: 1,
        },
      },
    },
    {
      key: 'loads',
      title: 'Cargas de prova',
      description: 'Cargas oficiais por categoria — confira o regulamento da temporada vigente.',
      fields: {
        stationLoadsKg: {
          kind: 'table',
          label: 'Carga por estação (kg)',
          hint: 'Use o regulamento oficial da temporada. Estações sem carga ficam em 0.',
          rows: hyroxStationSchema.options.map((station) => ({
            key: station,
            label: HYROX_STATION_LABELS[station],
          })),
          columns: {
            openMale: {
              kind: 'number',
              label: 'Open M',
              hint: '',
              unit: 'kg',
              min: 0,
              max: 400,
              example: 0,
            },
            openFemale: {
              kind: 'number',
              label: 'Open F',
              hint: '',
              unit: 'kg',
              min: 0,
              max: 400,
              example: 0,
            },
            proMale: {
              kind: 'number',
              label: 'Pro M',
              hint: '',
              unit: 'kg',
              min: 0,
              max: 400,
              example: 0,
            },
            proFemale: {
              kind: 'number',
              label: 'Pro F',
              hint: '',
              unit: 'kg',
              min: 0,
              max: 400,
              example: 0,
            },
          },
        },
      },
    },
  ],
  guidance: [
    {
      key: 'principles',
      title: 'Princípios',
      hint: 'O que decide o resultado no HYROX e como priorizar com pouco tempo.',
    },
    {
      key: 'stationTechnique',
      title: 'Técnica das estações',
      hint: 'Pontos de eficiência e erros comuns por estação.',
    },
    {
      key: 'pacing',
      title: 'Estratégia de ritmo',
      hint: 'Como distribuir o esforço entre corridas e estações.',
    },
  ],
};

const HYBRID: DomainSpec = {
  domain: 'HYBRID',
  title: 'Treino híbrido',
  description:
    'Como conciliar modalidades (inclusive o esporte que o aluno já pratica): interferência, carga total e prioridades.',
  owner: 'CREF',
  sections: [
    {
      key: 'interference',
      title: 'Interferência',
      description: 'Espaçamento entre estímulos que competem.',
      fields: {
        hoursBetweenHeavyLowerAndIntenseRun: {
          kind: 'number',
          label: 'Horas entre inferiores pesado e corrida intensa',
          hint: 'Separar reduz a interferência em força e potência.',
          reference: 'Wilson et al., 2012; Schumann et al., 2022',
          unit: 'h',
          min: 0,
          max: 72,
          plausible: [6, 48],
          example: 24,
        },
        maxIntenseSessionsPerWeek: {
          kind: 'number',
          label: 'Máximo de sessões intensas por semana (todas as modalidades)',
          hint: 'Conta força pesada, corrida de qualidade, HYROX e esporte intenso.',
          min: 1,
          max: 8,
          plausible: [2, 5],
          example: 4,
        },
        allowTwoSessionsSameDay: {
          kind: 'boolean',
          label: 'Permitir duas sessões no mesmo dia',
          hint: 'Só quando a rotina do aluno exige e com pelo menos 6 h entre elas.',
          example: false,
        },
        minRestDaysPerWeek: {
          kind: 'number',
          label: 'Dias de descanso por semana',
          hint: 'Sem treino prescrito (o esporte externo do aluno conta).',
          unit: 'dias',
          min: 0,
          max: 3,
          plausible: [1, 2],
          example: 1,
        },
      },
    },
    {
      key: 'load',
      title: 'Carga total',
      description: 'Carga interna (PSE × minutos) somando todas as modalidades.',
      fields: {
        acuteChronicMax: {
          kind: 'number',
          label: 'Relação aguda:crônica máxima',
          hint: 'Carga dos últimos 7 dias ÷ média semanal das últimas 4. Acima disso, segurar.',
          min: 1,
          max: 2,
          step: 0.05,
          plausible: [1.2, 1.5],
          example: 1.3,
        },
        weeklyLoadIncreaseMaxPct: {
          kind: 'number',
          label: 'Aumento máximo da carga semanal total',
          hint: 'Em relação à média das últimas semanas.',
          unit: '%',
          min: 0,
          max: 40,
          plausible: [5, 15],
          example: 10,
        },
      },
    },
  ],
  guidance: [
    {
      key: 'priorities',
      title: 'Prioridades',
      hint: 'Como decidir o que vem primeiro quando objetivos competem.',
    },
    {
      key: 'externalSport',
      title: 'Esporte do aluno',
      hint: 'Como planejar em volta do esporte que o aluno já pratica.',
    },
  ],
};

const NUTRITION: DomainSpec = {
  domain: 'NUTRITION',
  title: 'Nutrição',
  description:
    'Estratégia energética, proteína e macronutrientes por objetivo, limites de segurança, recomposição e suplementação.',
  owner: 'CRN',
  sections: [
    {
      key: 'protein',
      title: 'Proteína',
      description: 'Gramas por kg de peso corporal por objetivo.',
      fields: {
        gPerKgByGoal: {
          kind: 'table',
          label: 'Proteína por objetivo',
          hint: 'Em déficit, use o topo da faixa para preservar massa magra.',
          reference: 'Jäger et al., ISSN 2017; Morton et al., 2018',
          rows: [
            { key: 'HYPERTROPHY', label: 'Hipertrofia' },
            { key: 'FAT_LOSS', label: 'Perda de gordura' },
            { key: 'RECOMPOSITION', label: 'Recomposição' },
            { key: 'ENDURANCE', label: 'Endurance' },
            { key: 'HEALTH', label: 'Saúde' },
          ],
          columns: {
            gPerKg: {
              kind: 'range',
              label: 'g/kg',
              hint: '',
              unit: 'g/kg',
              min: 0.8,
              max: 3.5,
              step: 0.1,
              plausible: [1.0, 2.7],
              example: { min: 1.6, max: 2.2 },
            },
          },
        },
        perMealMinG: {
          kind: 'number',
          label: 'Proteína mínima por refeição principal',
          hint: 'Distribuir a proteína ao longo do dia.',
          unit: 'g',
          min: 10,
          max: 60,
          plausible: [20, 40],
          example: 25,
        },
      },
    },
    {
      key: 'energy',
      title: 'Energia',
      description: 'Estimativa de gasto e ajuste por estratégia.',
      fields: {
        estimationMethod: {
          kind: 'choice',
          label: 'Equação de gasto basal',
          hint: 'Katch-McArdle só com % de gordura confiável.',
          options: [
            { value: 'MIFFLIN_ST_JEOR', label: 'Mifflin-St Jeor' },
            { value: 'KATCH_MCARDLE', label: 'Katch-McArdle (com % de gordura)' },
          ],
          example: 'MIFFLIN_ST_JEOR',
        },
        deficitPct: {
          kind: 'range',
          label: 'Déficit em relação ao gasto',
          hint: 'Déficits maiores aceleram a perda e pioram adesão e preservação muscular.',
          unit: '%',
          min: 0,
          max: 40,
          plausible: [10, 25],
          example: { min: 15, max: 20 },
        },
        surplusPct: {
          kind: 'range',
          label: 'Superávit em relação ao gasto',
          hint: 'Superávit pequeno limita ganho de gordura.',
          unit: '%',
          min: 0,
          max: 30,
          plausible: [5, 15],
          example: { min: 5, max: 10 },
        },
        recompositionDeficitPct: {
          kind: 'range',
          label: 'Ajuste na recomposição',
          hint: 'Leve déficit ou manutenção com proteína alta e treino de força.',
          unit: '%',
          min: 0,
          max: 25,
          plausible: [0, 15],
          example: { min: 5, max: 10 },
        },
        maxWeeklyWeightLossPct: {
          kind: 'number',
          label: 'Perda de peso máxima por semana',
          hint: 'Percentual do peso corporal; acima disso, reavaliar a estratégia.',
          unit: '%',
          min: 0.2,
          max: 2,
          step: 0.1,
          plausible: [0.5, 1.0],
          example: 0.7,
        },
        energyFloorKcal: {
          kind: 'table',
          label: 'Piso de energia diária',
          hint: 'Nunca prescrever abaixo disso sem acompanhamento presencial.',
          rows: [
            { key: 'FEMALE', label: 'Mulheres' },
            { key: 'MALE', label: 'Homens' },
          ],
          columns: {
            kcal: {
              kind: 'number',
              label: 'kcal',
              hint: '',
              unit: 'kcal',
              min: 800,
              max: 3000,
              plausible: [1200, 1800],
              example: 1500,
            },
          },
        },
      },
    },
    {
      key: 'recomposition',
      title: 'Recomposição corporal',
      description: 'Quando a estratégia de recomposição substitui o superávit pedido pelo aluno.',
      fields: {
        bodyFatThresholdPct: {
          kind: 'table',
          label: '% de gordura a partir do qual priorizar recomposição',
          hint: 'Aluno com objetivo de hipertrofia acima disso recebe recomposição em vez de superávit.',
          rows: [
            { key: 'FEMALE', label: 'Mulheres' },
            { key: 'MALE', label: 'Homens' },
          ],
          columns: {
            pct: {
              kind: 'number',
              label: '%',
              hint: '',
              unit: '%',
              min: 10,
              max: 50,
              plausible: [18, 35],
              example: 25,
            },
          },
        },
        waistToHeightThreshold: {
          kind: 'number',
          label: 'Relação cintura/altura de alerta',
          hint: 'Alternativa quando não há % de gordura confiável.',
          min: 0.3,
          max: 0.8,
          step: 0.01,
          plausible: [0.45, 0.6],
          example: 0.5,
        },
      },
    },
    {
      key: 'micro',
      title: 'Outros alvos diários',
      description: 'Gordura mínima, fibras e água.',
      fields: {
        fatMinGPerKg: {
          kind: 'number',
          label: 'Gordura mínima',
          hint: 'Abaixo disso, prejuízo hormonal e de adesão.',
          unit: 'g/kg',
          min: 0.3,
          max: 1.5,
          step: 0.1,
          plausible: [0.5, 1.0],
          example: 0.7,
        },
        fiberGPer1000Kcal: {
          kind: 'number',
          label: 'Fibras',
          hint: '',
          unit: 'g/1000 kcal',
          min: 5,
          max: 25,
          plausible: [10, 16],
          example: 14,
        },
        waterMlPerKg: {
          kind: 'number',
          label: 'Água',
          hint: 'Mais em dias quentes e de treino longo.',
          unit: 'ml/kg',
          min: 20,
          max: 60,
          plausible: [30, 45],
          example: 35,
        },
      },
    },
    {
      key: 'supplements',
      title: 'Suplementação',
      description: 'O que a IA pode sugerir dentro do escopo aprovado.',
      fields: {
        allowed: {
          kind: 'multiChoice',
          label: 'Suplementos que podem ser sugeridos',
          hint: 'Só suplementos com evidência e segurança estabelecidas. O resto exige consulta.',
          options: [
            { value: 'CREATINE', label: 'Creatina' },
            { value: 'WHEY', label: 'Whey/proteína em pó' },
            { value: 'CAFFEINE', label: 'Cafeína' },
            { value: 'VITAMIN_D', label: 'Vitamina D (com exame)' },
            { value: 'OMEGA_3', label: 'Ômega 3' },
            { value: 'ELECTROLYTES', label: 'Eletrólitos (endurance)' },
          ],
          example: ['CREATINE', 'WHEY'],
        },
      },
    },
  ],
  guidance: [
    {
      key: 'principles',
      title: 'Princípios',
      hint: 'Como a MOVIVO pensa alimentação: flexibilidade, preferência, rotina real.',
    },
    {
      key: 'mealStructure',
      title: 'Estrutura das refeições',
      hint: 'Exemplos práticos, refeições fora de casa, orçamento apertado.',
    },
    {
      key: 'referral',
      title: 'Quando encaminhar',
      hint: 'Sinais que exigem consulta com nutricionista ou médico.',
    },
  ],
};

const RECOVERY: DomainSpec = {
  domain: 'RECOVERY',
  title: 'Recuperação',
  description: 'Sinais de recuperação insuficiente e quando segurar a progressão.',
  owner: 'CREF',
  sections: [
    {
      key: 'flags',
      title: 'Sinais de atenção',
      description: 'Limiares que fazem o sistema investigar antes de progredir.',
      fields: {
        minSleepHours: {
          kind: 'number',
          label: 'Sono abaixo de',
          hint: 'Média de 3 noites abaixo disso segura a progressão.',
          unit: 'h',
          min: 3,
          max: 9,
          step: 0.5,
          plausible: [5, 7],
          example: 6,
        },
        rpeAbovePlannedBy: {
          kind: 'number',
          label: 'PSE acima da prevista em',
          hint: 'Duas sessões seguidas acima disso = investigar fadiga.',
          unit: 'pontos',
          min: 0.5,
          max: 5,
          step: 0.5,
          plausible: [1.5, 3],
          example: 2,
        },
        performanceDropSessions: {
          kind: 'number',
          label: 'Sessões seguidas com queda de desempenho',
          hint: 'Mesma carga, menos repetições (ou mesmo ritmo, FC mais alta).',
          min: 1,
          max: 6,
          plausible: [2, 4],
          example: 3,
        },
      },
    },
  ],
  guidance: [
    {
      key: 'principles',
      title: 'Princípios',
      hint: 'Diferença entre um dia ruim e uma tendência; o que ajustar primeiro.',
    },
  ],
};

const ADHERENCE: DomainSpec = {
  domain: 'ADHERENCE',
  title: 'Adesão e comunicação proativa',
  description: 'Quando intervir, quanto mensagem é demais e o que oferecer em dias difíceis.',
  owner: 'CREF_CRN',
  sections: [
    {
      key: 'intervention',
      title: 'Intervenção',
      description: 'Quando o sistema age sobre faltas e baixa adesão.',
      fields: {
        missedInARowToAsk: {
          kind: 'number',
          label: 'Faltas seguidas para perguntar o que houve',
          hint: 'Pergunta curta, sem cobrança.',
          min: 1,
          max: 5,
          plausible: [1, 3],
          example: 1,
        },
        lowAdherenceRate: {
          kind: 'number',
          label: 'Adesão de 4 semanas considerada baixa',
          hint: 'Sessões feitas ÷ planejadas. Abaixo disso, o agente de adesão investiga barreiras.',
          unit: '%',
          min: 10,
          max: 90,
          plausible: [40, 70],
          example: 60,
        },
        planBMinutes: {
          kind: 'number',
          label: 'Duração da sessão mínima de dia difícil',
          hint: 'A versão curta que mantém o hábito.',
          unit: 'min',
          min: 5,
          max: 45,
          plausible: [10, 30],
          example: 20,
        },
      },
    },
    {
      key: 'contact',
      title: 'Limites de contato',
      description: 'Para o acompanhamento não virar ruído.',
      fields: {
        maxProactivePerDay: {
          kind: 'number',
          label: 'Mensagens proativas por dia (fora segurança)',
          hint: '',
          min: 0,
          max: 6,
          plausible: [1, 3],
          example: 2,
        },
        maxProactivePerWeek: {
          kind: 'number',
          label: 'Mensagens proativas por semana',
          hint: '',
          min: 0,
          max: 30,
          plausible: [3, 12],
          example: 8,
        },
        quietHours: {
          kind: 'range',
          label: 'Horário de silêncio (início → fim)',
          hint: 'Hora local do aluno; mensagem de segurança ignora o silêncio.',
          unit: 'h',
          min: 0,
          max: 23,
          example: { min: 7, max: 22 },
        },
      },
    },
  ],
  guidance: [
    {
      key: 'barriers',
      title: 'Barreiras',
      hint: 'Como diferenciar tempo, cansaço, logística, motivação e dor — e o que fazer em cada uma.',
    },
  ],
};

const SAFETY: DomainSpec = {
  domain: 'SAFETY',
  title: 'Segurança',
  description:
    'Gatilhos que suspendem a autonomia, gravidade de cada sinal e quando orientar atendimento.',
  owner: 'CREF_CRN',
  sections: [
    {
      key: 'pain',
      title: 'Dor',
      description: 'Limiares para relatos de dor (escala 0–10).',
      fields: {
        stopExerciseAt: {
          kind: 'number',
          label: 'Interromper o exercício com dor a partir de',
          hint: 'Durante a execução.',
          min: 1,
          max: 10,
          plausible: [3, 6],
          example: 5,
        },
        escalateAt: {
          kind: 'number',
          label: 'Encaminhar à equipe com dor a partir de',
          hint: 'Qualquer relato com essa intensidade abre caso.',
          min: 1,
          max: 10,
          plausible: [5, 8],
          example: 7,
        },
        persistentDays: {
          kind: 'number',
          label: 'Dor persistente após',
          hint: 'Mesma região relatada por esse número de dias.',
          unit: 'dias',
          min: 1,
          max: 30,
          plausible: [3, 14],
          example: 7,
        },
      },
    },
    {
      key: 'signals',
      title: 'Sinais e gravidade',
      description: 'O que cada sinal faz.',
      fields: {
        bySignal: {
          kind: 'table',
          label: 'Gravidade e escopo por sinal',
          hint: 'EMERGÊNCIA orienta atendimento imediato e bloqueia tudo; URGENTE abre caso prioritário.',
          rows: safetySignalKindSchema.options.map((kind) => ({
            key: kind,
            label: SAFETY_SIGNAL_LABELS[kind],
          })),
          columns: {
            severity: {
              kind: 'choice',
              label: 'Gravidade',
              hint: '',
              options: [
                { value: 'ATTENTION', label: 'Atenção' },
                { value: 'URGENT', label: 'Urgente' },
                { value: 'EMERGENCY', label: 'Emergência' },
              ],
              example: 'URGENT',
            },
            scope: {
              kind: 'choice',
              label: 'Suspende',
              hint: '',
              options: [
                { value: 'TRAINING', label: 'Treino' },
                { value: 'NUTRITION', label: 'Nutrição' },
                { value: 'ALL', label: 'Tudo' },
              ],
              example: 'ALL',
            },
          },
        },
      },
    },
  ],
  guidance: [
    {
      key: 'emergencyMessage',
      title: 'Mensagem de emergência',
      hint: 'O que dizer ao aluno ao orientar atendimento imediato.',
    },
    {
      key: 'scope',
      title: 'Limites de atuação',
      hint: 'O que a MOVIVO nunca faz (diagnóstico, medicação, tratamento).',
    },
  ],
};

const AUTONOMY: DomainSpec = {
  domain: 'AUTONOMY',
  title: 'Autonomia',
  description:
    'O que a IA pode fazer sozinha, dentro de que limite, quando pergunta ao aluno e quando encaminha.',
  owner: 'CREF_CRN',
  sections: [
    {
      key: 'actions',
      title: 'Ações',
      description: 'Nível de autonomia e limite por tipo de ação.',
      fields: {
        byAction: {
          kind: 'table',
          label: 'Autonomia por ação',
          hint: 'O limite só vale no nível "automático dentro do limite"; o significado está no rótulo da ação.',
          rows: coachingActionTypeSchema.options.map((action) => ({
            key: action,
            label: AUTONOMY_ACTION_LABELS[action],
          })),
          columns: {
            level: {
              kind: 'choice',
              label: 'Nível',
              hint: '',
              options: AUTONOMY_LEVEL_OPTIONS,
              example: 'AUTO',
            },
            limit: { kind: 'number', label: 'Limite', hint: '', min: 0, max: 1000, example: 0 },
          },
        },
        highUncertainty: {
          kind: 'choice',
          label: 'Proposta com incerteza alta',
          hint: 'O que fazer quando o próprio agente diz que não tem certeza.',
          options: [
            { value: 'ASK', label: 'Perguntar ao aluno' },
            { value: 'ESCALATE', label: 'Encaminhar à equipe' },
          ],
          example: 'ASK',
        },
        onLimitExceeded: {
          kind: 'choice',
          label: 'Quando a proposta passa do limite',
          hint: '',
          options: [
            { value: 'ASK', label: 'Perguntar ao aluno' },
            { value: 'ESCALATE', label: 'Encaminhar à equipe' },
          ],
          example: 'ESCALATE',
        },
      },
    },
  ],
  guidance: [
    {
      key: 'principles',
      title: 'Princípios',
      hint: 'Quando a equipe quer ser envolvida mesmo que a regra permita.',
    },
  ],
};

const COMMUNICATION: DomainSpec = {
  domain: 'COMMUNICATION',
  title: 'Comunicação',
  description: 'Voz da MOVIVO nas mensagens: tom, tamanho, termos proibidos.',
  owner: 'CREF_CRN',
  sections: [
    {
      key: 'style',
      title: 'Estilo',
      description: 'Como a MOVIVO escreve no WhatsApp.',
      fields: {
        maxMessageChars: {
          kind: 'number',
          label: 'Tamanho máximo de uma mensagem',
          hint: 'Mensagens longas são lidas pela metade.',
          unit: 'caracteres',
          min: 100,
          max: 3000,
          plausible: [300, 1200],
          example: 700,
        },
        emojis: {
          kind: 'choice',
          label: 'Emojis',
          hint: '',
          options: [
            { value: 'NONE', label: 'Nunca' },
            { value: 'SPARING', label: 'Com moderação' },
            { value: 'FREE', label: 'Livre' },
          ],
          example: 'SPARING',
        },
        forbiddenTerms: {
          kind: 'textList',
          label: 'Termos que nunca aparecem',
          hint: 'Um por linha.',
          maxItems: 60,
          itemMaxLength: 60,
          example: ['diagnóstico', 'tratamento', 'cura', 'resultado garantido'],
        },
      },
    },
  ],
  guidance: [
    {
      key: 'voice',
      title: 'Voz',
      hint: 'Como a MOVIVO fala: proximidade, clareza, incentivo sem culpa.',
    },
    { key: 'examples', title: 'Exemplos', hint: 'Mensagens boas e ruins, com o porquê.' },
  ],
};

export const METHODOLOGY_DOMAIN_SPECS: readonly DomainSpec[] = [
  STRENGTH,
  RUNNING,
  HYROX,
  HYBRID,
  NUTRITION,
  RECOVERY,
  ADHERENCE,
  SAFETY,
  AUTONOMY,
  COMMUNICATION,
];

export const methodologyDomainSchema = z.enum([
  'STRENGTH',
  'RUNNING',
  'HYROX',
  'HYBRID',
  'NUTRITION',
  'RECOVERY',
  'ADHERENCE',
  'SAFETY',
  'AUTONOMY',
  'COMMUNICATION',
]);
export type MethodologyDomain = z.infer<typeof methodologyDomainSchema>;

export function methodologyDomainSpec(domain: string): DomainSpec {
  const spec = METHODOLOGY_DOMAIN_SPECS.find((s) => s.domain === domain);
  if (!spec) throw new Error(`domínio de metodologia desconhecido: ${domain}`);
  return spec;
}
