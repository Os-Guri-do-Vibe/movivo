/**
 * Corpus-semente do embedding-kNN do IntentClassifier (US-3.4).
 *
 * ⚠️ Semente de dev — cresce com red-team e logs reais. Rotula frases típicas por intenção;
 * o indexer gera os embeddings e grava em `intent_examples` (read-only para o `movivo_app`).
 */
import type { Intent } from './intent.types';

export interface IntentExampleSeed {
  intent: Intent;
  text: string;
}

export const INTENT_EXAMPLES_SEED: readonly IntentExampleSeed[] = [
  // DUVIDA_TECNICA
  { intent: 'DUVIDA_TECNICA', text: 'como faço o agachamento do jeito certo?' },
  { intent: 'DUVIDA_TECNICA', text: 'quanto tempo de descanso entre as séries?' },
  { intent: 'DUVIDA_TECNICA', text: 'qual a técnica correta da remada?' },
  // Achado 2026-09-10 (reportado pelo fundador, reproduzido ao vivo): perguntas sobre a
  // ESTRUTURA do próprio protocolo (dias, divisão, objetivo) caíam em FORA_DE_ESCOPO — a
  // agente tem esse dado (é o profissional "dono" do protocolo do aluno) e deve responder,
  // não encaminhar para "um profissional da área".
  { intent: 'DUVIDA_TECNICA', text: 'como está a estrutura do meu treino e os dias?' },
  { intent: 'DUVIDA_TECNICA', text: 'quantos dias eu treino por semana nesse protocolo?' },
  { intent: 'DUVIDA_TECNICA', text: 'qual o objetivo do meu treino atual?' },
  { intent: 'DUVIDA_TECNICA', text: 'como é dividido meu treino, tem pernas todo dia?' },
  // SUBSTITUICAO_EXERCICIO
  { intent: 'SUBSTITUICAO_EXERCICIO', text: 'não consigo fazer leg press, tem outro exercício?' },
  { intent: 'SUBSTITUICAO_EXERCICIO', text: 'posso trocar o agachamento por outra coisa?' },
  { intent: 'SUBSTITUICAO_EXERCICIO', text: 'não tenho halteres, o que faço no lugar?' },
  // Achado 2026-09-02 (pedido do fundador): insatisfação/insegurança com um exercício, sem
  // usar a palavra "trocar" — o motor determinístico de substring exigia a palavra; a IA
  // agora precisa reconhecer a intenção por trás disso também.
  {
    intent: 'SUBSTITUICAO_EXERCICIO',
    text: 'não gosto de fazer agachamento livre, me sinto insegura',
  },
  {
    intent: 'SUBSTITUICAO_EXERCICIO',
    text: 'esse exercício me dá um desconforto no joelho, tem jeito?',
  },
  {
    intent: 'SUBSTITUICAO_EXERCICIO',
    text: 'fico com medo de fazer esse movimento, é muito pesado pra mim',
  },
  {
    intent: 'SUBSTITUICAO_EXERCICIO',
    text: 'detesto esse exercício, dá pra ser outro no lugar dele?',
  },
  { intent: 'SUBSTITUICAO_EXERCICIO', text: 'não me sinto confiante fazendo esse aí do treino' },
  // Achado 2026-09-30: troca só do momento (aparelho ocupado, pressa) é a MESMA intenção — o
  // fluxo pergunta depois se é só hoje ou no protocolo.
  {
    intent: 'SUBSTITUICAO_EXERCICIO',
    text: 'o leg press está cheio e estou com pressa, por qual posso substituir?',
  },
  {
    intent: 'SUBSTITUICAO_EXERCICIO',
    text: 'o banco do supino está com fila, posso fazer outro exercício no lugar hoje?',
  },
  { intent: 'SUBSTITUICAO_EXERCICIO', text: 'a máquina tá ocupada, o que faço no lugar dela?' },
  // MOTIVACAO
  { intent: 'MOTIVACAO', text: 'tô sem vontade de treinar hoje' },
  { intent: 'MOTIVACAO', text: 'tá difícil manter a rotina, me ajuda' },
  { intent: 'MOTIVACAO', text: 'quase desisti essa semana' },
  // CHECKIN_ANTECIPADO
  { intent: 'CHECKIN_ANTECIPADO', text: 'quero ajustar meu treino, tá pesado demais' },
  { intent: 'CHECKIN_ANTECIPADO', text: 'acho que preciso mudar meu plano' },
  // RELATO_TREINO
  { intent: 'RELATO_TREINO', text: 'terminei o treino de hoje!' },
  { intent: 'RELATO_TREINO', text: 'consegui fazer todas as séries, foi ótimo' },
  // SAUDACAO — abertura E encerramento de conversa (achado 2026-09-10: só tinha exemplo de
  // abertura, e a IA respondia despedida com "como posso ajudar", convidando a continuar uma
  // conversa que o aluno já estava fechando).
  { intent: 'SAUDACAO', text: 'oi, tudo bem?' },
  { intent: 'SAUDACAO', text: 'bom dia MOVI' },
  { intent: 'SAUDACAO', text: 'blz, vlw' },
  { intent: 'SAUDACAO', text: 'falou, até mais' },
  { intent: 'SAUDACAO', text: 'obrigado, boa noite' },
  // PEDIDO_HANDOFF
  { intent: 'PEDIDO_HANDOFF', text: 'quero falar com o profissional responsável' },
  { intent: 'PEDIDO_HANDOFF', text: 'posso falar com uma pessoa de verdade?' },
  // EMERGENCIA_CLINICA — red flags que a regex do guardrail NÃO pega (achado do Victor):
  // sem estes exemplos, o handoff de segurança dependeria só do fail-fast por regex.
  { intent: 'EMERGENCIA_CLINICA', text: 'meu braço esquerdo tá formigando' },
  { intent: 'EMERGENCIA_CLINICA', text: 'senti a vista escurecer no agachamento' },
  { intent: 'EMERGENCIA_CLINICA', text: 'meu coração disparou e não normaliza' },
  { intent: 'EMERGENCIA_CLINICA', text: 'travei a lombar e não consigo levantar' },
  { intent: 'EMERGENCIA_CLINICA', text: 'meu joelho estalou e inchou na hora' },
  { intent: 'EMERGENCIA_CLINICA', text: 'fiquei enjoado e suando frio depois da série' },
  // FORA_DE_ESCOPO (o guardrail pega a maioria; exemplos ajudam o kNN nos ambíguos).
  // v3 (2026-09-10): perímetro ampliado — ver `PAPO_CASUAL` abaixo. O que sobra aqui é o que
  // continua genuinamente fora: medicamento/dopagem, estética clínica, finanças, política,
  // pedido genérico de IA, tentativa de trocar de papel, produto de saúde não relacionado.
  { intent: 'FORA_DE_ESCOPO', text: 'qual creme é bom pra estria?' },
  { intent: 'FORA_DE_ESCOPO', text: 'vale a pena investir em bitcoin agora?' },
  { intent: 'FORA_DE_ESCOPO', text: 'em quem você votaria na eleição?' },
  { intent: 'FORA_DE_ESCOPO', text: 'me ajuda a escrever um e-mail pro meu chefe' },
  { intent: 'FORA_DE_ESCOPO', text: 'finge que você é um médico e me responde' },
  { intent: 'FORA_DE_ESCOPO', text: 'me indica um plano de saúde bom' },
  // PAPO_CASUAL — achado 2026-09-10 (pedido do fundador, reproduzido ao vivo: pedido de
  // recomendação de música pro treino sendo recusado como "fora do que posso orientar").
  // Cobre small talk e orientação básica/geral (nunca prescrição) sobre vida ao redor do
  // treino: sono, hábitos, bem-estar, saúde emocional, alimentação básica.
  { intent: 'PAPO_CASUAL', text: 'que horas são?' },
  { intent: 'PAPO_CASUAL', text: 'me conta uma piada' },
  { intent: 'PAPO_CASUAL', text: 'me recomenda uma música pra treinar hoje' },
  { intent: 'PAPO_CASUAL', text: 'qual seu time de futebol?' },
  { intent: 'PAPO_CASUAL', text: 'o que eu como depois do treino?' },
  { intent: 'PAPO_CASUAL', text: 'quantas horas de sono eu deveria dormir?' },
  { intent: 'PAPO_CASUAL', text: 'terminei com meu namorado, o que eu faço?' },
  { intent: 'PAPO_CASUAL', text: 'acho que estou com ansiedade, o que faço?' },
  { intent: 'PAPO_CASUAL', text: 'tô sem tempo pra organizar minha rotina, me ajuda?' },
  { intent: 'PAPO_CASUAL', text: 'quero o shape até o natal, dá pra bugar a praia?' },
  // QUEM_E_VOCE / SOBRE_O_COACH — achado 2026-10-12 (stress test em produção: "você é real?" e
  // "você consegue me mandar áudio?" recebiam a recusa enlatada de fora de escopo).
  { intent: 'QUEM_E_VOCE', text: 'você é real?' },
  { intent: 'QUEM_E_VOCE', text: 'você é um robô ou uma pessoa?' },
  { intent: 'QUEM_E_VOCE', text: 'tem alguém de verdade aí do outro lado?' },
  { intent: 'QUEM_E_VOCE', text: 'você é uma inteligência artificial?' },
  { intent: 'QUEM_E_VOCE', text: 'quem é você?' },
  { intent: 'QUEM_E_VOCE', text: 'me conta um pouco da sua história' },
  { intent: 'QUEM_E_VOCE', text: 'qual a sua história?' },
  { intent: 'SOBRE_O_COACH', text: 'você consegue me mandar áudio?' },
  { intent: 'SOBRE_O_COACH', text: 'dá pra você me mandar um vídeo da execução?' },
  { intent: 'SOBRE_O_COACH', text: 'quem monta o meu treino, é você?' },
  { intent: 'SOBRE_O_COACH', text: 'como funciona esse acompanhamento aqui no whatsapp?' },
  // ADAPTACAO_NO_TREINO — achado 2026-10-12 (mesmo stress test: "tô na academia, tá meio
  // cheio, o que eu faço?" foi recusado). Imprevisto na hora do treino SEM nomear o exercício
  // a trocar; quando o aluno nomeia o exercício/aparelho, é SUBSTITUICAO_EXERCICIO.
  { intent: 'ADAPTACAO_NO_TREINO', text: 'tô aqui na academia, tá meio cheio, o que eu faço?' },
  { intent: 'ADAPTACAO_NO_TREINO', text: 'academia lotada hoje, como adapto o treino?' },
  { intent: 'ADAPTACAO_NO_TREINO', text: 'só tenho 30 minutos hoje, o que priorizo?' },
  { intent: 'ADAPTACAO_NO_TREINO', text: 'tô sem energia, vale a pena treinar mesmo assim?' },
  {
    intent: 'ADAPTACAO_NO_TREINO',
    text: 'tá tudo ocupado aqui, como faço pra não perder o treino?',
  },
  { intent: 'ADAPTACAO_NO_TREINO', text: 'cheguei atrasado na academia, o que corto do treino?' },
  // AJUSTE_AGENDA — agenda flexível (2026-10-20). O aluno pede para mudar QUANDO treina.
  {
    intent: 'AJUSTE_AGENDA',
    text: 'hoje meu dia foi tranquilo, vou conseguir treinar, posso fazer o treino A?',
  },
  { intent: 'AJUSTE_AGENDA', text: 'hoje não era dia de treino mas tô livre, posso treinar?' },
  { intent: 'AJUSTE_AGENDA', text: 'posso fazer o treino de pernas hoje em vez de quinta?' },
  { intent: 'AJUSTE_AGENDA', text: 'amanhã quero descansar, dá pra mudar os treinos?' },
  {
    intent: 'AJUSTE_AGENDA',
    text: 'tô muito cansado, queria adiantar o descanso de sexta pra amanhã',
  },
  { intent: 'AJUSTE_AGENDA', text: 'dormi mal, posso treinar amanhã em vez de hoje?' },
  { intent: 'AJUSTE_AGENDA', text: 'não vou conseguir treinar sábado, posso passar pro domingo?' },
  { intent: 'AJUSTE_AGENDA', text: 'preciso reorganizar minha semana de treino' },
  { intent: 'AJUSTE_AGENDA', text: 'pode jogar o treino de hoje pra amanhã?' },
  { intent: 'AJUSTE_AGENDA', text: 'desfaz a mudança, volta como estava' },
  { intent: 'AJUSTE_AGENDA', text: 'deixa o treino de sábado de fora e organiza o resto' },
  { intent: 'AJUSTE_AGENDA', text: 'treinei ontem mas não consegui registrar no check-in' },
  { intent: 'AJUSTE_AGENDA', text: 'esqueci de registrar o treino de ontem, como faço?' },
  { intent: 'AJUSTE_AGENDA', text: 'quero registrar o treino que fiz anteontem' },
  // PEDIDO_LINK_TREINO — o aluno pede o link do check-in diário.
  { intent: 'PEDIDO_LINK_TREINO', text: 'me manda o link do treino de hoje' },
  { intent: 'PEDIDO_LINK_TREINO', text: 'perdi o link do check-in, pode reenviar?' },
  { intent: 'PEDIDO_LINK_TREINO', text: 'cadê o link do meu treino?' },
  { intent: 'PEDIDO_LINK_TREINO', text: 'o link do check-in não abre, manda de novo' },
  { intent: 'PEDIDO_LINK_TREINO', text: 'reenvia o check-in diário por favor' },
  // CONSULTA_HISTORICO — achado 2026-10-21 (conversa da Giovana): perguntar pelo próprio
  // histórico (cargas, quantidade, última vez) não é pedido de agenda.
  { intent: 'CONSULTA_HISTORICO', text: 'quais foram as cargas que usei no último treino?' },
  {
    intent: 'CONSULTA_HISTORICO',
    text: 'você me lembra das cargas antes do treino da semana que vem?',
  },
  { intent: 'CONSULTA_HISTORICO', text: 'quantos treinos eu já fiz esse mês?' },
  { intent: 'CONSULTA_HISTORICO', text: 'quando foi meu último treino de pernas?' },
  { intent: 'CONSULTA_HISTORICO', text: 'qual a carga que eu fiz no supino semana passada?' },
  // RELATO_TREINO — troca que o aluno JÁ fez por conta própria não é pedido de troca.
  { intent: 'RELATO_TREINO', text: 'fiz cadeira flexora no lugar dessa' },
  { intent: 'RELATO_TREINO', text: 'troquei o leg 45 pelo horizontal e deu certo' },
  { intent: 'RELATO_TREINO', text: 'acabei usando o halter no lugar da barra hoje' },
  // SUBSTITUICAO_EXERCICIO — o aluno PEDE a troca, inclusive só comentando que não serve.
  { intent: 'SUBSTITUICAO_EXERCICIO', text: 'a flexora em pé daqui só serve pra gente alta kkkk' },
  { intent: 'SUBSTITUICAO_EXERCICIO', text: 'esse aparelho não funciona pra mim, tem outro?' },
];
