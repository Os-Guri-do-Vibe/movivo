/**
 * Evidência para a revisão semanal (mensagens proativas de hábitos e de recuperação).
 *
 * O código mede os sinais nos números reais do aluno; esta camada só decide QUE ASSUNTO buscar nos
 * artigos. A consulta vem de rótulos fixos escritos aqui, um por tipo de sinal: nunca de texto do
 * aluno, de resposta de check-in nem de dado de saúde. Por isso nada pessoal vai ao provedor de
 * embedding, e a mesma situação sempre busca o mesmo assunto.
 */
import type { ReviewSignal, ReviewSignalKind } from '@movivo/shared';

import type {
  EvidenceChunk,
  KnowledgeRetrievalService,
} from '../../core/knowledge/knowledge-retrieval.service';

/** Assunto buscado para cada sinal que tem leitura de analista. Sinais de peso não buscam. */
export const SIGNAL_TOPIC: Readonly<Partial<Record<ReviewSignalKind, string>>> = {
  ADHERENCE_LOW:
    'adesão ao treino: manter a consistência e retomar a rotina com o menor passo possível',
  KEY_SESSIONS_SKIPPED:
    'sessões perdidas: planejar obstáculos e alternativas para manter a rotina de treino',
  NUTRITION_UNDERLOGGED:
    'registro da alimentação: automonitoramento simples, feedback e consistência',
  BARRIER_REPORTED:
    'barreiras para treinar: capacidade, oportunidade e motivação, e como adaptar a rotina',
  EFFORT_HIGH: 'esforço percebido alto: fadiga, recuperação e carga de treino',
  LOAD_SPIKE: 'aumento brusco da carga de treino: progressão, recuperação e risco de lesão',
  RECOVERY_LOW: 'sono e recuperação ruins: fadiga, energia baixa e ajuste do treino',
  PAIN_REPORTED: 'dor durante os treinos: sinais de alerta e quando buscar avaliação profissional',
};

/** Dois assuntos por leitura: mais que isso dilui a busca e gasta contexto à toa. */
const MAX_TOPICS = 2;
const MAX_EVIDENCE = 3;

/** Os assuntos (sem repetição, na ordem dos sinais) que a leitura de uma área deve buscar. */
export function evidenceTopicsFor(
  signals: readonly ReviewSignal[],
  area: ReadonlySet<ReviewSignalKind>,
): string[] {
  const topics = signals
    .filter((signal) => area.has(signal.kind))
    .map((signal) => SIGNAL_TOPIC[signal.kind])
    .filter((topic): topic is string => topic !== undefined);
  return [...new Set(topics)].slice(0, MAX_TOPICS);
}

/** Intercala os resultados de cada assunto, sem repetir trecho, até o limite do agente. */
export function mergeEvidence(lists: readonly EvidenceChunk[][]): EvidenceChunk[] {
  const merged: EvidenceChunk[] = [];
  const seen = new Set<string>();
  const longest = Math.max(0, ...lists.map((list) => list.length));
  for (let index = 0; index < longest && merged.length < MAX_EVIDENCE; index += 1) {
    for (const list of lists) {
      const chunk = list[index];
      if (!chunk || seen.has(chunk.id) || merged.length >= MAX_EVIDENCE) continue;
      seen.add(chunk.id);
      merged.push(chunk);
    }
  }
  return merged;
}

/**
 * A evidência de uma área (hábitos ou recuperação) para os sinais da semana. Lista vazia quando
 * não há busca configurada, não há sinal da área ou nada passou do piso de similaridade.
 */
export async function collectEvidence(
  retrieval: Pick<KnowledgeRetrievalService, 'evidenceForTopic'> | null,
  signals: readonly ReviewSignal[],
  area: ReadonlySet<ReviewSignalKind>,
): Promise<EvidenceChunk[]> {
  if (!retrieval) return [];
  const topics = evidenceTopicsFor(signals, area);
  const lists = await Promise.all(topics.map((topic) => retrieval.evidenceForTopic(topic)));
  return mergeEvidence(lists);
}
