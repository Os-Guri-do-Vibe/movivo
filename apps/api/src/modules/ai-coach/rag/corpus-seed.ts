/**
 * Corpus-semente do RAG para DEV (US-3.3).
 *
 * ⚠️ RASCUNHO — A VALIDAR PELO RT CREF. Poucos trechos curtos só para exercitar o pipeline em
 * dev. O corpus real é alimentado pelo profissional CREF via dashboard (Sprint 5); não há
 * "tamanho mínimo" aqui — o gate de qualidade é o profissional ter carregado material.
 */
import type { CorpusDocument } from './corpus-indexer';

export const SEED_CORPUS: readonly CorpusDocument[] = [
  {
    title: 'Descanso entre séries',
    topic: 'descanso',
    content:
      'O descanso entre séries para hipertrofia costuma ficar entre 60 e 90 segundos. ' +
      'Para força, descansos maiores (2 a 3 minutos) permitem recuperar melhor entre séries pesadas.',
    reliability: 4,
  },
  {
    title: 'Frequência semanal para hipertrofia',
    topic: 'hipertrofia',
    content:
      'Treinar cada grupo muscular 2 vezes por semana tende a otimizar a hipertrofia em ' +
      'comparação a uma única vez, mantendo o volume semanal semelhante.',
    reliability: 4,
  },
  {
    title: 'Progressão de carga',
    topic: 'progressao',
    content:
      'A dupla progressão sobe as repetições até o topo da faixa e só então aumenta a carga, ' +
      'permitindo progresso contínuo sem saltos bruscos de peso.',
    reliability: 4,
  },
  // --- Técnicas avançadas da metodologia v2 do RT: sem estes trechos, DUVIDA_TECNICA não
  // tem base para responder quando o aluno pergunta "o que é drop-set?" e cai no fallback.
  {
    title: 'Drop-set',
    topic: 'tecnicas-avancadas',
    content:
      'No drop-set, ao terminar a série você reduz a carga e continua o movimento com pouco ou ' +
      'nenhum descanso. É um recurso pontual, usado principalmente no último exercício do grupo ' +
      'ou na última série, e indicado para quem já tem experiência de treino.',
    reliability: 5,
  },
  {
    title: 'Rest-pause',
    topic: 'tecnicas-avancadas',
    content:
      'No rest-pause você leva a série até perto da falha, descansa de 10 a 20 segundos e faz ' +
      'novas repetições com a mesma carga. Pode repetir mais de uma vez conforme o nível. É uma ' +
      'técnica de alta intensidade, reservada a intermediários e avançados.',
    reliability: 5,
  },
  {
    title: 'Cluster-set e pirâmide',
    topic: 'tecnicas-avancadas',
    content:
      'No cluster-set a série é dividida em blocos pequenos com pausas curtas, por exemplo 4 ' +
      'blocos de 3 repetições com 10 a 20 segundos entre eles. Na pirâmide, a carga ou as ' +
      'repetições aumentam ou diminuem progressivamente ao longo das séries.',
    reliability: 5,
  },
  {
    title: 'Bi-set, tri-set e superset',
    topic: 'tecnicas-avancadas',
    content:
      'Bi-set são dois exercícios feitos em sequência com pouco ou nenhum descanso entre eles; ' +
      'tri-set são três, do mesmo grupo ou de grupos diferentes. Superset costuma juntar ' +
      'músculos opostos, como bíceps e tríceps, em sequência.',
    reliability: 5,
  },
  {
    title: 'Isometria, repetições controladas e descanso ativo',
    topic: 'tecnicas-avancadas',
    content:
      'Na isometria você segura a posição por um tempo determinado, por exemplo 10 a 30 segundos ' +
      'no ponto de maior tensão. Repetições controladas usam cadência mais lenta, principalmente ' +
      'na descida, com subida controlada. No descanso ativo, o intervalo é ocupado por atividade ' +
      'leve como mobilidade, caminhada ou respiração.',
    reliability: 5,
  },
];
