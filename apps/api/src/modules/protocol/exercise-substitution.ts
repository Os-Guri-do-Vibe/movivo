/**
 * Substituição segura de exercício (US-3.5 / TASK-3.5.2).
 *
 * MOVI **nunca inventa** um exercício: o substituto sai SEMPRE da base de referência (US-2.1),
 * no mesmo padrão de movimento, dentro do nível/equipamento do usuário e **nunca contraindicado**
 * por lesão/PAR-Q. A IA só verbaliza a troca; o `ValidationService.validateResponse` confirma.
 *
 * Achado 2026-09-02 (pedido do fundador): o motor determinístico de ESCOLHA deixou de existir
 * — `findExerciseByMention` (match por substring) e `findSafeSubstitute` (pega o 1º viável)
 * foram removidos. A IA agora tem autonomia para IDENTIFICAR o exercício-alvo e para conversar
 * sobre as opções (ver `SubstitutionTargetService`/`SubstitutionResolutionService`,
 * `apps/api/src/modules/coach/`). O que **continua** determinístico, sem exceção, é o filtro
 * de SEGURANÇA (`isViable` abaixo) — tanto antes de qualquer opção ser mostrada ao aluno
 * (`findSafeCandidates`) quanto na recomputação final antes de persistir qualquer troca.
 */
import {
  type CatalogExercise,
  type ContraindicationTag,
  type ExerciseLevel,
  type ExerciseLocation,
  servesLocation,
} from './exercise-catalog';

const LEVEL_ORDER: Record<ExerciseLevel, number> = {
  INICIANTE: 0,
  INTERMEDIARIO: 1,
  AVANCADO: 2,
};

/** Restrições do usuário que filtram um substituto seguro. */
export interface SubstitutionConstraints {
  level: ExerciseLevel;
  location: ExerciseLocation;
  equipment: readonly string[];
  injuryTags: readonly ContraindicationTag[];
}

/**
 * O exercício é seguro e viável para este usuário?
 *
 * Achado 2026-09-02: existiu aqui um `equipmentAvailable()` que exigia
 * `ex.equipment.every((e) => c.equipment.includes(e))` — mas `c.equipment` é SEMPRE `[]`
 * (a anamnese não pergunta equipamento item a item; é o LOCAL que determina o que existe,
 * de propósito — ver comentário em `protocol-generation.worker.ts`). Na prática isso vetava
 * TODO substituto que precisasse de halteres/barra/máquina, em qualquer local, sempre —
 * quem pedia pra trocar um exercício em academia completa só recebia opção de peso do
 * corpo. `servesLocation` abaixo já é a fonte de verdade de equipamento (mesmo critério do
 * catálogo do gerador); não duplicar com um segundo filtro que nunca reflete a realidade.
 */
export function isViable(ex: CatalogExercise, c: SubstitutionConstraints): boolean {
  return (
    LEVEL_ORDER[ex.minLevel] <= LEVEL_ORDER[c.level] &&
    servesLocation(ex, c.location) &&
    !ex.contraindicatedFor.some((t) => c.injuryTags.includes(t))
  );
}

/**
 * O candidato treina o mesmo padrão de movimento E pelo menos um grupo muscular em comum com
 * o alvo? (achado 2026-09-09, bug reportado pelo fundador via conversa real: "Supino Reto"
 * recebeu "Tríceps Testa" como opção "segura"). `pattern` sozinho não basta — é uma
 * classificação automática, mais grosseira que grupo muscular real (ver comentário de topo do
 * arquivo): existem entradas do catálogo com o MESMO `pattern` de um exercício mas
 * `muscleGroups` completamente diferente (ex.: `supino_fechado_barra`, `pattern:
 * HORIZONTAL_PUSH`, `muscleGroups: ['tríceps']`, colide de padrão com `supino_reto_*`, peito).
 * Sem checar `muscleGroups` também, essas colisões passavam como candidato "seguro".
 *
 * Exceção: `CARDIO`. Ali `muscleGroups` não descreve um alvo muscular específico — é só um
 * rótulo de catálogo que varia sem diferença clínica real (`'corpo todo'` numas entradas,
 * `'sistema cardiovascular'` noutras, para exercícios igualmente intercambiáveis, ex.:
 * "Esteira" ↔ "Caminhada de Mala (Halter)"); exigir sobreposição aqui rejeitaria trocas
 * cardio legítimas por causa só do rótulo. Mesmo `pattern` já basta pra esse grupo.
 */
export function isPlausibleSubstitution(
  target: CatalogExercise,
  candidate: CatalogExercise,
): boolean {
  if (candidate.pattern !== target.pattern) return false;
  if (target.pattern === 'CARDIO') return true;
  return candidate.muscleGroups.some((group) => target.muscleGroups.includes(group));
}

/**
 * Tamanho do LOTE de apresentação ao aluno numa troca — humanizado, não uma lista exaustiva
 * de uma vez. Achado 2026-09-09 (pedido do fundador): isto NÃO é mais o teto da curadoria —
 * `findSafeCandidates` abaixo devolve TODOS os elegíveis, sem limite. O worker
 * (`ai-response.worker.ts::buildSubstitution`) é quem fatia a curadoria em lotes deste
 * tamanho, oferecendo o próximo lote quando o aluno rejeita o atual (ver o offset em Redis
 * por `userId`+exercício-alvo).
 */
export const SUBSTITUTION_BATCH_SIZE = 3;

/**
 * Candidatos seguros no mesmo padrão de movimento, para a IA oferecer humanizadamente — TODOS
 * os elegíveis, sem teto (achado 2026-09-09, pedido do fundador: a curadoria é ilimitada, só a
 * APRESENTAÇÃO ao aluno é feita em lotes — ver `SUBSTITUTION_BATCH_SIZE`). Ordem de
 * prioridade de sempre: lista `substitutes` curada do exercício primeiro (é clinicamente
 * curada, não arbitrária — não reordenar), depois qualquer outro do mesmo padrão. `[]` =
 * nada seguro disponível na base para este aluno.
 */
export function findSafeCandidates(
  target: CatalogExercise,
  c: SubstitutionConstraints,
  catalog: readonly CatalogExercise[],
): CatalogExercise[] {
  const byId = (id: string) => catalog.find((e) => e.id === id);
  const curated = target.substitutes.map(byId).filter((e): e is CatalogExercise => Boolean(e));
  const samePattern = catalog.filter(
    (e) => e.id !== target.id && isPlausibleSubstitution(target, e),
  );
  const seen = new Set<string>();
  const candidates: CatalogExercise[] = [];
  for (const candidate of [...curated, ...samePattern]) {
    if (candidate.id === target.id || seen.has(candidate.id)) continue;
    if (!isViable(candidate, c)) continue;
    seen.add(candidate.id);
    candidates.push(candidate);
  }
  return candidates;
}
