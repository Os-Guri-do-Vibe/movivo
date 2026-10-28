/** Acesso a posição de lista que DEVE existir (falha alto em vez de `undefined` silencioso). */
export function at<T>(list: readonly T[], index: number): T {
  const value = list[index];
  if (value === undefined) throw new RangeError(`posição ${index} fora da lista (${list.length})`);
  return value;
}
