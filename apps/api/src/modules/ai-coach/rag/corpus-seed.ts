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
];
