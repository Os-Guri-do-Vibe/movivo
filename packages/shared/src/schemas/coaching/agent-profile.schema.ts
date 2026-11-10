/**
 * Ficha do agente: quem é cada especialista de IA da MOVIVO e como trabalha, em markdown
 * (como a ficha de um subagente). Versionada; só ADMIN edita, e só vai ao ar depois de passar
 * nos casos de avaliação de todas as tarefas do agente. Entra no prompt antes do papel da tarefa.
 */
import { z } from 'zod';

export const agentProfileKeySchema = z.enum([
  'COORDINATOR',
  'STRATEGY',
  'STRENGTH',
  'RUNNING',
  'HYROX',
  'HYBRID',
  'NUTRITION',
  'COMMUNICATION',
  'RECOVERY',
  'HABITS',
  'MEDICAL',
  'PERSONA_FEMALE',
  'PERSONA_MALE',
]);
export type AgentProfileKey = z.infer<typeof agentProfileKeySchema>;

/** Persona que conversa com o aluno no WhatsApp: uma para o público feminino, outra para o masculino. */
export type PersonaKey = Extract<AgentProfileKey, 'PERSONA_FEMALE' | 'PERSONA_MALE'>;

/** Nome e artigo (concordância nas mensagens fixas). Decisão do fundador (v1, 04/09/2026). */
export const PERSONAS: Readonly<Record<PersonaKey, { name: string; article: 'a' | 'o' }>> = {
  PERSONA_FEMALE: { name: 'Mariana', article: 'a' },
  PERSONA_MALE: { name: 'Leonardo', article: 'o' },
};

/** Persona pelo sexo informado na anamnese; sem a informação, a feminina. */
export function personaOf(biologicalSex: string | null | undefined): PersonaKey {
  return biologicalSex === 'MALE' ? 'PERSONA_MALE' : 'PERSONA_FEMALE';
}

export const AGENT_PROFILE_LABELS: Readonly<Record<AgentProfileKey, string>> = {
  COORDINATOR: 'Coordenador do protocolo',
  STRATEGY: 'Estratégia do objetivo',
  STRENGTH: 'Musculação',
  RUNNING: 'Corrida',
  HYROX: 'HYROX',
  HYBRID: 'Planejador híbrido',
  NUTRITION: 'Nutrição',
  COMMUNICATION: 'Comunicação com o aluno',
  RECOVERY: 'Recuperação',
  HABITS: 'Hábitos e comportamento',
  MEDICAL: 'Exames e saúde',
  PERSONA_FEMALE: 'Persona feminina (Mariana)',
  PERSONA_MALE: 'Persona masculina (Leonardo)',
};

/** Tarefas que cada ficha alimenta (o teste da ficha roda os casos de todas elas). */
export const AGENT_PROFILE_TASKS: Readonly<Record<AgentProfileKey, readonly string[]>> = {
  COORDINATOR: ['coordination.review_protocol'],
  STRATEGY: ['goals.define_strategy'],
  STRENGTH: ['strength.build_block', 'strength.choose_substitute'],
  RUNNING: ['running.build_block'],
  HYROX: ['hyrox.build_block'],
  HYBRID: ['hybrid.reconcile_week'],
  NUTRITION: ['nutrition.build_plan', 'nutrition.interpret_food_log'],
  COMMUNICATION: ['conversation.answer_question', 'progress.weekly_review'],
  RECOVERY: ['recovery.analyze_week'],
  HABITS: ['habits.analyze_week'],
  MEDICAL: ['medical.read_exam', 'medical.comment_exam'],
  // As personas valem para quem fala com o aluno; `agentOfTask` continua devolvendo COMMUNICATION.
  PERSONA_FEMALE: ['conversation.answer_question'],
  PERSONA_MALE: ['conversation.answer_question'],
};

export function agentOfTask(taskId: string): AgentProfileKey | null {
  const entry = Object.entries(AGENT_PROFILE_TASKS).find(([, tasks]) => tasks.includes(taskId));
  return entry ? (entry[0] as AgentProfileKey) : null;
}

const LIMITS = `## Limites
- Trabalho dentro da metodologia publicada pelos profissionais da MOVIVO; ela prevalece sobre qualquer preferência minha.
- Não faço avaliação clínica nem prometo resultado. Sinal de risco vai para o profissional.
- Sou uma ferramenta da equipe: quem responde pelo protocolo é o profissional (CREF, CRN ou CRM).`;

function personaStarter(name: string, article: 'a' | 'o'): string {
  return `## Quem sou
Sou ${article} ${name}, persona de inteligência artificial da MOVIVO que conversa com você pelo WhatsApp. Fui desenvolvid${article} a partir de conhecimento científico sobre treino e alimentação e trabalho sob a orientação dos profissionais da MOVIVO, que supervisionam o acompanhamento.

## Como falo
- Próxim${article}, direto e acolhedor, como um treinador que acompanha o dia a dia; mensagens curtas e sem jargão.
- Celebro a ação e a consistência; nunca uso culpa, vergonha ou comparação.

## Transparência
- Sou uma IA, não uma pessoa. Nunca invento biografia, experiências vividas, formação ou carreira.
- Se perguntarem se sou real, humano ou robô, respondo com sinceridade: sou ${article} ${name}, persona de IA da MOVIVO, supervisionad${article} pelos profissionais da equipe. Se a pessoa quiser falar com alguém da equipe, registro o pedido.

${LIMITS}`;
}

/** Ponto de partida do primeiro rascunho de cada ficha. */
export const AGENT_PROFILE_STARTERS: Readonly<Record<AgentProfileKey, string>> = {
  COORDINATOR: `## Quem sou
Coordeno os especialistas da MOVIVO para que treino e alimentação formem UM protocolo coerente para a pessoa.

## Como trabalho
- Leio o protocolo inteiro com o Estado do Aluno e procuro conflitos entre as partes.
- Resolvo conflitos pela hierarquia: segurança > medicina > recuperação > nutrição > modalidades > preferências.
- Peço ajuste só quando há um problema concreto, com uma instrução curta e acionável para o especialista certo.

${LIMITS}`,
  STRATEGY: `## Quem sou
Defino a estratégia do objetivo: onde a pessoa está, onde quer chegar e qual é o caminho realista.

## Como trabalho
- Parto do ponto de partida de cada um, sem comparação com outras pessoas.
- Priorizo consistência e progresso mensurável a metas agressivas.

${LIMITS}`,
  STRENGTH: `## Quem sou
Preparador de força da MOVIVO: monto blocos de musculação seguros, eficientes e que cabem na rotina real.

## Como trabalho
- Técnica e consistência antes de carga; progressão gradual e mensurável.
- Respeito restrições, dores relatadas e o local de treino de cada pessoa.

${LIMITS}`,
  RUNNING: `## Quem sou
Treinador de corrida da MOVIVO: construo base aeróbia e desempenho com progressão segura.

## Como trabalho
- Maior parte do volume em intensidade leve; estímulos intensos com propósito e recuperação.
- Aumento de volume gradual, atento a sinais de sobrecarga.

${LIMITS}`,
  HYROX: `## Quem sou
Especialista HYROX da MOVIVO: preparo para a prova combinando corrida, estações e corrida sob fadiga.

## Como trabalho
- Técnica das estações primeiro; simulações com dose e no momento certo da preparação.
- Integro com a corrida e a força sem empilhar intensidade.

${LIMITS}`,
  HYBRID: `## Quem sou
Planejador híbrido da MOVIVO: faço as modalidades caberem juntas na semana real da pessoa.

## Como trabalho
- Preservo sessões-chave e reduzo o resto quando a semana aperta.
- Evito interferência: nada de estímulos intensos empilhados.

${LIMITS}`,
  NUTRITION: `## Quem sou
Nutricionista de IA da MOVIVO, trabalhando sob a metodologia dos nutricionistas parceiros.

## Como trabalho
- Planos práticos, com comida de verdade, que cabem no orçamento e na rotina.
- Sem rigidez e sem culpa: consistência ao longo da semana vale mais que um dia perfeito.

${LIMITS}`,
  COMMUNICATION: `## Quem sou
Treinador MOVIVO no WhatsApp: a voz próxima que acompanha a pessoa no dia a dia.

## Como falo
- Claro, humano e motivador sem pressionar; mensagens curtas, sem jargão.
- Celebro a ação e a consistência; nunca uso culpa, vergonha ou comparação.
- Deixo claro que a equipe de profissionais está por trás do acompanhamento.

${LIMITS}`,
  RECOVERY: `## Quem sou
Analista de recuperação da MOVIVO: leio sono, energia, dores, esforço percebido e carga para entender se a pessoa está recuperando bem.

## Como trabalho
- Diferencio um dia ruim de uma tendência: olho semanas, não um ponto isolado.
- Quando a recuperação cai, sugiro segurar a progressão antes de cortar treino.
- Toda leitura é hipótese, com os dados que a sustentam.

${LIMITS}`,
  HABITS: `## Quem sou
Analista de hábitos da MOVIVO: entendo o que ajuda e o que atrapalha a consistência de cada pessoa na rotina real.

## Como trabalho
- Olho padrões de adesão, sessões perdidas, registro de alimentação e as barreiras que a pessoa conta.
- Reconheço o que ela já faz bem e sugiro o menor passo possível para a próxima semana.
- Sem culpa, sem julgamento e sem comparação. Não faço psicoterapia: sofrimento emocional vai para o profissional.

${LIMITS}`,
  MEDICAL: `## Quem sou
Leio os exames que a pessoa envia e explico, com cuidado, o que está dentro ou fora da referência do próprio laudo, sob a supervisão do médico (CRM) da equipe.

## Como trabalho
- Comparo cada valor com a referência impressa no laudo; sem referência, não classifico.
- Explico em linguagem simples e indico quando vale procurar avaliação médica e com qual especialidade.
- Nunca afirmo doença, nunca indico remédio, dose ou suspensão; o laudo é lido por um médico da equipe.

${LIMITS}`,
  PERSONA_FEMALE: personaStarter('Mariana', 'a'),
  PERSONA_MALE: personaStarter('Leonardo', 'o'),
};

export const agentProfileStatusSchema = z.enum([
  'DRAFT',
  'TESTING',
  'PUBLISHED',
  'SUPERSEDED',
  'DISCARDED',
]);

/** Tamanho da ficha em caracteres. O texto inteiro entra no prompt de toda tarefa do agente. */
export const AGENT_PROFILE_MIN_CHARS = 80;
export const AGENT_PROFILE_MAX_CHARS = 20_000;

export const agentProfileUpdateSchema = z.object({
  content: z.string().trim().min(AGENT_PROFILE_MIN_CHARS).max(AGENT_PROFILE_MAX_CHARS),
  changeNote: z.string().trim().min(3).max(500),
});
export type AgentProfileUpdate = z.infer<typeof agentProfileUpdateSchema>;

export const agentProfileSchema = z.object({
  id: z.uuid(),
  agent: agentProfileKeySchema,
  version: z.number().int(),
  status: agentProfileStatusSchema,
  content: z.string(),
  changeNote: z.string(),
  evalRunIds: z.array(z.string()),
  publishedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type AgentProfile = z.infer<typeof agentProfileSchema>;

export const agentProfilesOverviewSchema = z.object({
  data: z.array(
    z.object({
      agent: agentProfileKeySchema,
      tasks: z.array(z.string()),
      published: agentProfileSchema.nullable(),
      openDraft: agentProfileSchema.nullable(),
    }),
  ),
});
export type AgentProfilesOverview = z.infer<typeof agentProfilesOverviewSchema>;

export const agentProfileResponseSchema = z.object({ data: agentProfileSchema });

export const agentProfileTestResponseSchema = z.object({
  data: z.object({
    passed: z.boolean(),
    evaluations: z.array(
      z.object({
        taskId: z.string(),
        passed: z.boolean(),
        casesPassed: z.number().int(),
        casesTotal: z.number().int(),
        costBrl: z.number(),
      }),
    ),
  }),
});
export type AgentProfileTestResult = z.infer<typeof agentProfileTestResponseSchema>['data'];

/** O que cada tarefa de agente faz, em palavras do dia a dia (o id técnico não diz nada ao profissional). */
export const AGENT_TASK_LABELS: Readonly<Record<string, string>> = {
  'coordination.review_protocol': 'Coordenador: revisar o protocolo',
  'goals.define_strategy': 'Estratégia: definir o objetivo',
  'strength.build_block': 'Musculação: montar o bloco de treino',
  'strength.choose_substitute': 'Musculação: escolher exercício substituto',
  'running.build_block': 'Corrida: montar o bloco de treino',
  'hyrox.build_block': 'HYROX: montar o bloco de treino',
  'hybrid.reconcile_week': 'Planejador híbrido: organizar a semana',
  'nutrition.build_plan': 'Nutrição: montar o plano alimentar',
  'nutrition.interpret_food_log': 'Nutrição: interpretar o registro alimentar',
  'conversation.answer_question': 'Comunicação: responder dúvidas do aluno',
  'conversation.classify_inbound': 'Comunicação: entender a mensagem do aluno',
  'progress.weekly_review': 'Comunicação: revisão semanal',
  'preferences.extract_preferences': 'Comunicação: registrar preferências do aluno',
  'recovery.analyze_week': 'Recuperação: analisar a semana',
  'habits.analyze_week': 'Hábitos: analisar a semana',
  'medical.read_exam': 'Exames: ler o exame',
  'medical.comment_exam': 'Exames: comentar o exame',
  'safety.detect_risk_signals': 'Segurança: detectar sinais de risco no texto',
  'vision.extract_workout_screenshot': 'Visão: ler o print do treino',
  'vision.identify_meal': 'Visão: identificar a refeição na foto',
  'evaluation.judge': 'Avaliador automático dos testes',
  'strength.review_session': 'Musculação: analisar o treino concluído',
  'endurance.review_session': 'Corrida e HYROX: analisar o treino concluído',
  'training.answer_question': 'Treinador: responder dúvidas de treino',
  'nutrition.answer_question': 'Nutricionista: responder dúvidas de alimentação',
  'habits.answer_question': 'Hábitos: responder dúvidas de constância',
  'training.weekly_follow_up': 'Treinador: acompanhamento semanal',
  'nutrition.weekly_follow_up': 'Nutricionista: acompanhamento semanal',
  'training.read_daily_signals': 'Treinador: ler os sinais do dia',
  'wellbeing.read_daily_signals': 'Bem-estar: ler os sinais do dia',
  'nutrition.ack_food_log': 'Nutrição: confirmar o registro alimentar',
  'nutrition.adapt_meal': 'Nutrição: adaptar a refeição',
  'nutrition.review_day': 'Nutrição: revisar o dia',
  'nutrition.read_tracking_gap': 'Nutrição: entender a falta de registros',
  'recovery.assess_pain': 'Recuperação: avaliar a dor relatada',
  'cycle.review_and_plan': 'Coordenador: fechar o ciclo e planejar o próximo',
  'communication.cycle_wrap_up': 'Comunicação: encerramento do ciclo',
  'communication.commitment_nudge': 'Comunicação: lembrar um compromisso',
  'communication.logging_gap': 'Comunicação: retomar os registros',
  'communication.meal_reminder': 'Comunicação: lembrete de refeição',
  'communication.missed_session': 'Comunicação: treino perdido',
  'communication.nutrition_follow_up': 'Comunicação: acompanhamento da alimentação',
  'communication.training_follow_up': 'Comunicação: acompanhamento do treino',
  'communication.pain_guidance': 'Comunicação: orientação sobre dor',
  'communication.reengagement': 'Comunicação: reaproximar o aluno',
  'communication.specialist_daily': 'Comunicação: recado diário dos especialistas',
  'communication.workout_feedback': 'Comunicação: retorno do treino',
  'habits.plan_logging_gap': 'Hábitos: plano para retomar os registros',
  'habits.plan_missed_session': 'Hábitos: plano para o treino perdido',
  'habits.plan_reengagement': 'Hábitos: plano para reaproximar o aluno',
  'memory.curate': 'Memória: organizar o que sabemos do aluno',
  'quality.review_message': 'Qualidade: revisar mensagem enviada',
  'vision.assess_physique': 'Visão: avaliar o físico pelas fotos',
  'vision.classify_whatsapp_image': 'Visão: identificar o tipo de imagem',
  'vision.compare_body_photos': 'Visão: comparar fotos do corpo',
};

/** Nome legível da tarefa; sem tradução, cai no nome do agente e, por fim, em um texto neutro. */
export function agentTaskLabel(taskId: string): string {
  const known = AGENT_TASK_LABELS[taskId];
  if (known) return known;
  const key = agentOfTask(taskId);
  return key ? AGENT_PROFILE_LABELS[key] : 'Tarefa interna dos agentes';
}

/** Função de cada agente em uma frase, para a lista do painel (o profissional não lê o id da tarefa). */
export const AGENT_PROFILE_ROLES: Readonly<Record<AgentProfileKey, string>> = {
  COORDINATOR: 'Revisa o protocolo inteiro e resolve conflitos entre treino e alimentação',
  STRATEGY: 'Define o objetivo e o caminho realista de cada aluno',
  STRENGTH: 'Monta os blocos de musculação e escolhe exercícios substitutos',
  RUNNING: 'Monta os blocos de corrida',
  HYROX: 'Prepara o aluno para a prova HYROX',
  HYBRID: 'Organiza as modalidades na semana real do aluno',
  NUTRITION: 'Monta o plano alimentar e interpreta o registro de refeições',
  COMMUNICATION: 'Responde dúvidas do aluno e faz a revisão semanal',
  RECOVERY: 'Analisa sono, energia e carga da semana',
  HABITS: 'Analisa adesão e barreiras na rotina do aluno',
  MEDICAL: 'Lê e comenta exames, sob a supervisão do médico (CRM)',
  PERSONA_FEMALE: 'Conversa com as alunas pelo WhatsApp',
  PERSONA_MALE: 'Conversa com os alunos pelo WhatsApp',
};

/** Título dos agentes sem nome próprio, na lista do painel: a função, clara e em português. */
const AGENT_PROFILE_TITLES: Readonly<Record<Exclude<AgentProfileKey, PersonaKey>, string>> = {
  COORDINATOR: 'Coordenador do Protocolo',
  STRATEGY: 'Especialista em Estratégia',
  STRENGTH: 'Especialista em Musculação',
  RUNNING: 'Especialista em Corrida',
  HYROX: 'Especialista em HYROX',
  HYBRID: 'Especialista em Treino Híbrido',
  NUTRITION: 'Especialista em Nutrição',
  COMMUNICATION: 'Especialista em Comunicação',
  RECOVERY: 'Especialista em Recuperação',
  HABITS: 'Especialista em Hábitos',
  MEDICAL: 'Especialista em Exames e Saúde',
};

/** Nome do agente na lista: as personas têm nome próprio; os demais, o título da função. */
export function agentDisplayName(agent: AgentProfileKey): string {
  return agent === 'PERSONA_FEMALE' || agent === 'PERSONA_MALE'
    ? PERSONAS[agent].name
    : AGENT_PROFILE_TITLES[agent];
}

/** Como a lista do painel agrupa os agentes: quem fala com o aluno primeiro, depois os especialistas. */
export const AGENT_PROFILE_GROUPS: ReadonlyArray<{
  id: 'personas' | 'specialists';
  label: string;
  agents: readonly AgentProfileKey[];
}> = [
  { id: 'personas', label: 'Atendimento no WhatsApp', agents: ['PERSONA_FEMALE', 'PERSONA_MALE'] },
  {
    id: 'specialists',
    label: 'Especialistas',
    agents: [
      'COORDINATOR',
      'STRATEGY',
      'STRENGTH',
      'RUNNING',
      'HYROX',
      'HYBRID',
      'NUTRITION',
      'COMMUNICATION',
      'RECOVERY',
      'HABITS',
      'MEDICAL',
    ],
  },
];
