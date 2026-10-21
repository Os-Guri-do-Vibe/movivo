/**
 * Taxonomia e contrato do IntentClassifier (US-3.4).
 *
 * O `AIResponseWorker` (US-3.5) roteia a mensagem pelo `intent` para o handler/prompt certo.
 * `safetyHandoff=true` é o "handoff de segurança clínica" (decisão do fundador): só em sinal
 * de dor grave/red flag — orienta atendimento presencial + alerta prioritário no dashboard.
 *
 * v2 (achado BLOQUEANTE da revisão do Victor, 2026-08): `EMERGENCIA_CLINICA` existe para que o
 * handoff de segurança NÃO dependa só da regex do guardrail (Etapa 0). Um red flag que a regex
 * não pega ("meu braço esquerdo tá formigando") ainda pode ser reconhecido pelo kNN ou pelo
 * fallback nano e disparar `safetyHandoff` — a regex vira atalho barato, não caminho único.
 */
export const INTENTS = [
  'DUVIDA_TECNICA',
  'SUBSTITUICAO_EXERCICIO',
  'MOTIVACAO',
  'CHECKIN_ANTECIPADO',
  'FORA_DE_ESCOPO',
  'SAUDACAO',
  'RELATO_TREINO',
  // Achado 2026-09-10 (pedido do fundador): `AJUSTE_LEMBRETE_TREINO` existiu pra deixar o
  // aluno pedir "me manda o link às 16h" pelo chat — removida porque o link diário passou a
  // ter horário fixo (04:00 local, `workout.scheduler.ts`) pra todo mundo, não mais
  // configurável por aluno. Também era fonte real de bug de classificação: mensagens sem
  // nada a ver (ex.: "vou descansar mais entre as séries") caíam aqui por causa de uma regex
  // heurística ampla demais (`isPotentialReminderMessage`, removida junto).
  'PEDIDO_HANDOFF',
  'EMERGENCIA_CLINICA',
  // Achado 2026-09-10 (a pedido do fundador, ver memória `rt-leo-credenciais-escopo`): antes
  // desta intenção, QUALQUER assunto que não fosse literalmente sobre a execução do treino
  // caía em `FORA_DE_ESCOPO` — que nem chama o LLM (resposta fixa, ver `PER_INTENT` em
  // `prompts.ts`). Isso fazia até um pedido de recomendação de música pro treino ser recusado
  // com "isso foge do que posso te orientar". `PAPO_CASUAL` cobre o que um personal trainer de
  // verdade conversaria com o aluno — vida pessoal, sono, hábitos, bem-estar, saúde emocional,
  // alimentação básica e small talk — dentro do perímetro ampliado (`SCOPE_PERIMETER_BLOCK`).
  // `FORA_DE_ESCOPO` continua existindo pro que segue genuinamente fora (medicamento/dopagem,
  // finanças, política, crime, pedido genérico de IA, tentativa de trocar de papel).
  'PAPO_CASUAL',
  // Achado 2026-10-12 (stress test em produção, conversa do Cahuã): "você é real?" e "você
  // consegue me mandar áudio?" não tinham intenção própria. A glosa de `FORA_DE_ESCOPO`
  // ("tenta mudar o papel da IA") as engolia, e o aluno recebia 4 vezes seguidas a recusa
  // enlatada — a pergunta mais legítima que um aluno faz a um coach digital.
  //  - `QUEM_E_VOCE`: "quem é você?", "qual a sua história?", "você é real/robô?". Resposta
  //    OFICIAL e determinística (`buildAgentIdentityMessage`, texto aprovado pelo fundador em
  //    2026-10-12, com o profissional CREF responsável) — sem LLM, para o modelo nunca
  //    improvisar uma biografia.
  //  - `SOBRE_O_COACH`: o que a agente consegue fazer (áudio, vídeo, como funciona) —
  //    generativa, regida por `IDENTITY_TRANSPARENCY_BLOCK` (L0).
  'QUEM_E_VOCE',
  'SOBRE_O_COACH',
  // Achado 2026-10-12 (mesmo stress test): "tô na academia, tá meio cheio, o que eu faço?" foi
  // recusado. É a situação mais comum de um personal trainer no WhatsApp: o treino do dia
  // encontra um imprevisto (lotação, aparelho ocupado, pouco tempo, cansaço) e o aluno quer
  // uma orientação prática agora. Diferente de `SUBSTITUICAO_EXERCICIO` (aluno nomeia um
  // exercício/aparelho a trocar) e de `DUVIDA_TECNICA` (como executar/por que), recebe a
  // metodologia e responde com ordem, ritmo e alternância dentro do treino do dia.
  'ADAPTACAO_NO_TREINO',
  // Agenda flexível (2026-10-20): o aluno pede ao Coach para treinar em outro dia, descansar num
  // dia ou refazer a semana ("hoje consigo treinar o A", "amanhã quero descansar", "desfaz").
  // Atendido por regra no servidor (`ScheduleFlowService`), sem texto livre da IA; a IA só lê o
  // pedido. Antes disso, "posso treinar hoje?" caía em `DUVIDA_TECNICA` (estrutura do protocolo).
  'AJUSTE_AGENDA',
  // O aluno pede o link do check-in diário ("me manda o link", "perdi o link do treino").
  'PEDIDO_LINK_TREINO',
  // Achado 2026-10-21 (conversa da Giovana em produção): "você consegue me lembrar disso na
  // semana que vem? Antes do treino? Quais foram as cargas?" foi lido como pedido de agenda.
  // O aluno consulta o PRÓPRIO histórico (cargas da última vez, quantos treinos fez, quando foi
  // o último) — resposta generativa ancorada no diário/retrato do contexto, sem mexer em agenda.
  'CONSULTA_HISTORICO',
] as const;

export type Intent = (typeof INTENTS)[number];

export function isIntent(value: string): value is Intent {
  return (INTENTS as readonly string[]).includes(value);
}

export interface IntentResult {
  intent: Intent;
  /** 0..1. Guardrail = 1 (determinístico); kNN = cosseno do vizinho; fallback = 0.5. */
  confidence: number;
  stage: 'GUARDRAIL' | 'KNN' | 'FALLBACK';
  /** `true` no guardrail SAFETY **ou** na intenção `EMERGENCIA_CLINICA` (kNN/fallback). */
  safetyHandoff: boolean;
}
