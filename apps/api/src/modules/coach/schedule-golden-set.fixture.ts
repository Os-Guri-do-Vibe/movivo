/**
 * Golden set da AGENDA FLEXÍVEL: 50 frases de aluno (ruidosas, de áudio transcrito, com
 * hesitação e vocativo) com a leitura esperada. Serve a dois usos:
 *   1. teste de unidade (`schedule-golden-set.spec.ts`): a fixture é coerente e o envelope que
 *      o modelo recebe, DEPOIS do scrubber real, continua identificando cada dia;
 *   2. avaliação contra o modelo REAL (`src/scripts/eval-agenda.ts`, manual, custa tokens),
 *      que mede o parser do pedido e a classificação de intenção.
 *
 * Dados 100% sintéticos: nenhum aluno real. As frases foram escritas a partir de padrões vistos
 * em conversas reais (caso Gabriel, 21/10/2026), sem nome nem dado de ninguém.
 *
 * Cenário fixo: hoje é QUARTA 21/10/2026, 12:09. Semana: seg descanso; ter A feito; qua B
 * previsto; qui C previsto; sex, sáb e dom descanso.
 */
import type {
  ParseScheduleRequest,
  ScheduleRequestAction,
} from './schedule-request-parser.service';

export const SCENARIO_TODAY = '2026-10-21';

export const SCENARIO_WEEK: ParseScheduleRequest['week'] = [
  { date: '2026-10-19', weekday: 'segunda', sessionKey: null, situation: 'descanso' },
  { date: '2026-10-20', weekday: 'terça', sessionKey: 'A', situation: 'feito' },
  { date: '2026-10-21', weekday: 'quarta', sessionKey: 'B', situation: 'previsto' },
  { date: '2026-10-22', weekday: 'quinta', sessionKey: 'C', situation: 'previsto' },
  { date: '2026-10-23', weekday: 'sexta', sessionKey: null, situation: 'descanso' },
  { date: '2026-10-24', weekday: 'sábado', sessionKey: null, situation: 'descanso' },
  { date: '2026-10-25', weekday: 'domingo', sessionKey: null, situation: 'descanso' },
];

export const SCENARIO_SESSIONS: ParseScheduleRequest['sessions'] = [
  { key: 'A', label: 'A (Peito e tríceps)' },
  { key: 'B', label: 'B (Potência e core)' },
  { key: 'C', label: 'C (Inferiores)' },
];

export const SCENARIO_RECENT_DAYS: NonNullable<ParseScheduleRequest['recentDays']> = [
  { date: '2026-10-20', weekday: 'terça' },
  { date: '2026-10-19', weekday: 'segunda' },
];

export const GOLDEN_USER = { name: 'Aluno Teste', email: null, phoneNumber: null, birthDate: null };

export function scenarioRequest(
  message: string,
  openQuestion?: string,
): Omit<ParseScheduleRequest, 'userId' | 'operationId' | 'user' | 'personaSlot'> {
  return {
    message,
    today: SCENARIO_TODAY,
    week: SCENARIO_WEEK,
    sessions: SCENARIO_SESSIONS,
    recentDays: SCENARIO_RECENT_DAYS,
    ...(openQuestion ? { openQuestion } : {}),
  };
}

/** `AGENDA`: o fluxo de agenda assume; `LINK`: pedido do link; `OTHER`: qualquer outro assunto. */
export type ExpectedRoute = 'AGENDA' | 'LINK' | 'OTHER';

export interface ScheduleGoldenCase {
  id: string;
  message: string;
  openQuestion?: string;
  /** Ações aceitas para o parser (a primeira é a esperada; as demais são leituras igualmente válidas). */
  actions: readonly ScheduleRequestAction[];
  /** Data esperada (ISO); `'FORA'` = pediu um dia fora da semana (a regra recusa); omitido = não importa. */
  date?: string | 'FORA' | null;
  sessionKey?: string;
  placements?: ReadonlyArray<{ sessionKey: string; date: string | null }>;
  leaveOut?: readonly string[];
  route: ExpectedRoute;
  /** A frase só faz sentido junto da pergunta em aberto (o fluxo aberto tem prioridade): não mede a rota. */
  skipRoute?: boolean;
}

const QUI = '2026-10-22';
const SEX = '2026-10-23';
const SAB = '2026-10-24';
const DOM = '2026-10-25';
const HOJE = SCENARIO_TODAY;

export const SCHEDULE_GOLDEN_SET: readonly ScheduleGoldenCase[] = [
  // --- o caso real que quebrou em produção (áudio longo, com vocativo e recado ao profissional) ---
  {
    id: 'audio-longo-quarta-para-sexta',
    message:
      'Fala Leozinho, tudo bom? Mano, hoje, igual eu tinha falado antes, dormi muito mal ontem, ' +
      'quebrou as pernas, e agora você tem a funcionalidade de trocar meu treino de hoje pra ' +
      'sexta, só essa semana, hein? Joga meu treino aí de quarta-feira pra sexta, por favor, ' +
      'amanhã eu faço o treino normal que tá previsto pra amanhã. Depois faz uma pergunta pro ' +
      'Léo, trocar meu protocolo quando ele estiver disponível pra descansar nos próximos ' +
      'protocolos da semana, meu descanso de sexta ou pra quarta ou pra quinta.',
    actions: ['TREINAR'],
    date: SEX,
    sessionKey: 'B',
    route: 'AGENDA',
  },
  {
    id: 'se-eu-quiser-amanha-para-sexta',
    message: 'E se eu quiser colocar o treino de amanhã pra sexta aí você pode fazer?',
    actions: ['TREINAR'],
    date: SEX,
    sessionKey: 'C',
    route: 'AGENDA',
  },
  {
    id: 'hoje-nao-so-amanha',
    message: 'Fechado, hoje não vou treinar, somente amanhã',
    actions: ['DESCANSAR'],
    date: HOJE,
    route: 'AGENDA',
  },
  {
    id: 'sexta-vou-treinar',
    message: 'Sexta vou treinar, vou mandar para você os dados',
    actions: ['TREINAR'],
    date: SEX,
    route: 'AGENDA',
  },
  {
    id: 'cansado-descanso-amanha-em-vez-de-sexta',
    message:
      'Léo eu estou muito cansado, não dormi direito essa noite, você pode dar o descanso ' +
      'amanhã ao invés de sexta? Tá foda',
    actions: ['DESCANSAR'],
    date: QUI,
    route: 'AGENDA',
  },
  {
    id: 'autocorrecao-sexta-nao-sabado',
    message:
      'é... Léo, tipo, hoje não, né, tá osso, joga pra... pra sexta, não, pra sábado, sábado é melhor',
    actions: ['TREINAR'],
    date: SAB,
    sessionKey: 'B',
    route: 'AGENDA',
  },
  {
    id: 'passa-de-hoje-para-amanha',
    message: 'hoje não vai dar, passa o treino de hoje pra amanhã',
    actions: ['TREINAR'],
    date: QUI,
    sessionKey: 'B',
    route: 'AGENDA',
  },
  {
    id: 'treino-de-hoje-amanha-de-manha',
    message: 'Léo, bom dia, tudo bem? Posso fazer o treino de hoje amanhã de manhã?',
    actions: ['TREINAR'],
    date: QUI,
    sessionKey: 'B',
    route: 'AGENDA',
  },
  {
    id: 'composto-hoje-amanha-sexta',
    message:
      'Fala Leozinho, hoje eu tô muito cansado, dormi mal, passa o treino de hoje pra amanhã ' +
      'que amanhã eu tô inteiro, e o de amanhã joga pra sexta',
    actions: ['REORGANIZAR'],
    placements: [
      { sessionKey: 'B', date: QUI },
      { sessionKey: 'C', date: SEX },
    ],
    route: 'AGENDA',
  },
  // --- treinar / descansar em um dia ---
  {
    id: 'descanso-amanha',
    message: 'amanhã quero descansar',
    actions: ['DESCANSAR'],
    date: QUI,
    route: 'AGENDA',
  },
  {
    id: 'treino-a-hoje',
    message: 'hoje consigo treinar, posso fazer o treino A?',
    actions: ['TREINAR'],
    date: HOJE,
    sessionKey: 'A',
    route: 'AGENDA',
  },
  {
    id: 'pernas-hoje-em-vez-de-quinta',
    message: 'posso fazer o de pernas hoje em vez de quinta?',
    actions: ['TREINAR'],
    date: HOJE,
    sessionKey: 'C',
    route: 'AGENDA',
  },
  {
    id: 'quinta-compromisso-sabado',
    message: 'quinta eu tenho compromisso, faço o treino de quinta no sábado',
    actions: ['TREINAR'],
    date: SAB,
    sessionKey: 'C',
    route: 'AGENDA',
  },
  {
    id: 'domingo-treinar',
    message: 'posso treinar domingo?',
    actions: ['TREINAR'],
    date: DOM,
    route: 'AGENDA',
  },
  {
    id: 'sabado-b',
    message: 'sábado eu quero treinar o B',
    actions: ['TREINAR'],
    date: SAB,
    sessionKey: 'B',
    route: 'AGENDA',
  },
  {
    id: 'mudei-de-ideia-quinta-descanso-sabado',
    message: 'mudei de ideia, quinta eu descanso e faço sábado',
    actions: ['TREINAR'],
    date: SAB,
    sessionKey: 'C',
    route: 'AGENDA',
  },
  {
    id: 'descanso-sexta',
    message: 'na sexta eu quero descansar',
    actions: ['DESCANSAR'],
    date: SEX,
    route: 'AGENDA',
  },
  {
    id: 'sem-tempo-hoje',
    message: 'tô sem tempo hoje, descansa hoje e empurra o resto',
    actions: ['DESCANSAR'],
    date: HOJE,
    route: 'AGENDA',
  },
  {
    id: 'dor-joelho-descansar-hoje',
    message: 'tô com o joelho incomodando, posso descansar hoje?',
    actions: ['DESCANSAR'],
    date: HOJE,
    route: 'AGENDA',
  },
  {
    id: 'troca-descanso-de-sexta-pela-quarta',
    message: 'troca o descanso de sexta pela quarta',
    actions: ['DESCANSAR'],
    date: HOJE,
    route: 'AGENDA',
  },
  {
    id: 'apagar-treino-de-quinta',
    message: 'pode tirar o treino de quinta dessa semana?',
    actions: ['DESCANSAR'],
    date: QUI,
    route: 'AGENDA',
  },
  {
    id: 'treino-hoje-mesmo',
    message: 'ah deixa, vou treinar hoje mesmo',
    actions: ['TREINAR', 'DESFAZER'],
    date: HOJE,
    route: 'AGENDA',
  },
  // --- reorganizar a semana ---
  {
    id: 'organiza-b-quinta-c-sexta',
    message: 'hoje eu descanso, o B vai pra quinta e o C pra sexta',
    actions: ['REORGANIZAR'],
    placements: [
      { sessionKey: 'B', date: QUI },
      { sessionKey: 'C', date: SEX },
    ],
    route: 'AGENDA',
  },
  {
    id: 'organiza-b-quinta-c-sabado',
    message: 'organiza a semana: B na quinta, C no sábado',
    actions: ['REORGANIZAR'],
    placements: [
      { sessionKey: 'B', date: QUI },
      { sessionKey: 'C', date: SAB },
    ],
    route: 'AGENDA',
  },
  {
    id: 'hoje-para-sabado-quinta-para-sexta',
    message: 'o treino de hoje fica pra sábado e o de quinta pra sexta',
    actions: ['REORGANIZAR'],
    placements: [
      { sessionKey: 'B', date: SAB },
      { sessionKey: 'C', date: SEX },
    ],
    route: 'AGENDA',
  },
  {
    id: 'dois-treinos-amanha',
    message: 'tô morto hoje, amanhã faço os dois treinos',
    actions: ['REORGANIZAR', 'TREINAR'],
    route: 'AGENDA',
  },
  {
    id: 'treinar-sexta-e-sabado',
    message: 'quero treinar sexta e sábado',
    actions: ['REORGANIZAR', 'TREINAR'],
    route: 'AGENDA',
  },
  // --- resposta à pergunta em aberto ---
  {
    id: 'escolha-c-fica-de-fora',
    message: 'o C',
    openQuestion: 'A semana está cheia. Qual treino fica de fora: B ou C?',
    actions: ['ESCOLHA'],
    leaveOut: ['C'],
    route: 'AGENDA',
    skipRoute: true,
  },
  {
    id: 'escolha-pelo-foco',
    message: 'deixa o de pernas pra lá',
    openQuestion: 'A semana está cheia. Qual treino fica de fora: B ou C?',
    actions: ['ESCOLHA'],
    leaveOut: ['C'],
    route: 'AGENDA',
    skipRoute: true,
  },
  // --- registro de treino que já passou ---
  {
    id: 'registrar-ontem',
    message: 'treinei ontem mas esqueci de registrar',
    actions: ['REGISTRAR'],
    date: '2026-10-20',
    route: 'AGENDA',
  },
  {
    id: 'registrar-anteontem-a',
    message: 'quero registrar o treino que fiz anteontem, foi o A',
    actions: ['REGISTRAR'],
    date: '2026-10-19',
    sessionKey: 'A',
    route: 'AGENDA',
  },
  {
    id: 'registrar-ontem-a',
    message: 'ontem eu treinei o A fora do dia, registra pra mim',
    actions: ['REGISTRAR'],
    date: '2026-10-20',
    sessionKey: 'A',
    route: 'AGENDA',
  },
  // --- desfazer e link ---
  { id: 'desfaz', message: 'desfaz', actions: ['DESFAZER'], route: 'AGENDA' },
  {
    id: 'volta-como-estava',
    message: 'volta como estava, por favor',
    actions: ['DESFAZER'],
    route: 'AGENDA',
  },
  {
    id: 'link-treino',
    message: 'me manda o link do treino',
    actions: ['LINK'],
    route: 'LINK',
  },
  {
    id: 'perdi-o-link',
    message: 'perdi o link do check-in, pode reenviar?',
    actions: ['LINK'],
    route: 'LINK',
  },
  // --- dia fora da semana: a regra recusa, o parser só sinaliza ---
  {
    id: 'domingo-que-vem',
    message: 'posso treinar domingo da semana que vem?',
    actions: ['TREINAR'],
    date: 'FORA',
    route: 'AGENDA',
  },
  {
    id: 'dia-30',
    message: 'dia 30 eu treino',
    actions: ['TREINAR'],
    date: 'FORA',
    route: 'AGENDA',
  },
  {
    id: 'quarta-que-vem-descanso',
    message: 'quarta que vem posso descansar?',
    actions: ['DESCANSAR'],
    date: 'FORA',
    route: 'AGENDA',
  },
  // --- NÃO é pedido de agenda: o fluxo precisa se abster ---
  {
    id: 'pergunta-sobre-poder-alterar',
    message: 'Então era o treino de hoje você não consegue alterar?',
    actions: ['OUTRO', 'TREINAR'],
    route: 'OTHER',
  },
  {
    id: 'so-o-de-amanha',
    message: 'Só o treino de amanhã?',
    actions: ['OUTRO'],
    route: 'OTHER',
  },
  {
    id: 'qual-treino-de-sexta',
    message: 'qual é o treino de sexta?',
    actions: ['OUTRO'],
    route: 'OTHER',
  },
  {
    id: 'qual-treino-de-amanha',
    message: 'e qual é o treino de amanhã?',
    actions: ['OUTRO'],
    route: 'OTHER',
  },
  {
    id: 'lembrar-cargas',
    message:
      'você consegue me lembrar disso na semana que vem? Antes do treino? Quais foram as cargas?',
    actions: ['OUTRO'],
    route: 'OTHER',
  },
  {
    id: 'me-lembra-de-treinar',
    message: 'me lembra de treinar amanhã',
    actions: ['OUTRO'],
    route: 'OTHER',
  },
  {
    id: 'o-que-acontece-se-pular',
    message: 'o que acontece se eu pular o treino de hoje?',
    actions: ['OUTRO'],
    route: 'OTHER',
  },
  {
    id: 'bom-dia',
    message: 'bom dia!',
    actions: ['OUTRO'],
    route: 'OTHER',
  },
  {
    id: 'tecnica-agachamento',
    message: 'como faço o agachamento sem machucar o joelho?',
    actions: ['OUTRO'],
    route: 'OTHER',
  },
  {
    id: 'trocar-exercicio',
    message: 'posso trocar o supino por outro exercício?',
    actions: ['OUTRO'],
    route: 'OTHER',
  },
  {
    id: 'treino-mais-tarde',
    message: 'vou treinar mais tarde, umas 21h',
    actions: ['OUTRO', 'TREINAR'],
    route: 'OTHER',
  },
];
