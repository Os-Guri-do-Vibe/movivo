/**
 * Comparação de textos para a Base de Conhecimento (metodologia versionada).
 *
 * Diff por linha (LCS) com destaque por palavra nas linhas que foram reescritas, e colapso
 * de trechos iguais. Sem dependências: a metodologia é um texto corrido e o que o fundador
 * precisa ver é "o que entrou, o que saiu" — não um patch de código.
 *
 * Custo: prefixo e sufixo idênticos são descartados antes do LCS (o caso comum é uma
 * edição localizada num texto longo). Se o miolo restante ainda for grande demais para a
 * tabela de programação dinâmica, devolve `approximate: true` tratando o miolo como
 * substituído por inteiro — correto, só menos fino.
 */

export type DiffOp = 'equal' | 'add' | 'remove';

export interface DiffSegment {
  text: string;
  changed: boolean;
}

export interface DiffLine {
  op: DiffOp;
  text: string;
  /** Número da linha na versão base (null para linhas adicionadas). */
  oldNumber: number | null;
  /** Número da linha na versão nova (null para linhas removidas). */
  newNumber: number | null;
  /** Presente quando a linha foi reescrita: trechos que mudaram dentro dela. */
  segments?: DiffSegment[];
}

export interface TextDiff {
  lines: DiffLine[];
  added: number;
  removed: number;
  /** true quando o miolo era grande demais para o LCS e foi tratado como substituição. */
  approximate: boolean;
}

/** Limite de células da tabela de LCS (≈ 16 MB em Int32Array). */
const MAX_LCS_CELLS = 4_000_000;
/** Acima disso a linha não ganha destaque por palavra (texto sem quebras). */
const MAX_WORD_TOKENS = 1500;

/** Acesso a posição que o algoritmo garante existir (índices sempre dentro dos limites). */
function at<T>(array: readonly T[], index: number): T {
  return array[index] as T;
}

function splitLines(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').split('\n');
}

/** LCS genérico sobre ids inteiros; devolve as operações na ordem do texto. */
function lcsOps(a: number[], b: number[]): DiffOp[] {
  const n = a.length;
  const m = b.length;
  const width = m + 1;
  const table = new Int32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * width + j] =
        a[i] === b[j]
          ? (table[(i + 1) * width + j + 1] ?? 0) + 1
          : Math.max(table[(i + 1) * width + j] ?? 0, table[i * width + j + 1] ?? 0);
    }
  }
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push('equal');
      i++;
      j++;
    } else if ((table[(i + 1) * width + j] ?? 0) >= (table[i * width + j + 1] ?? 0)) {
      ops.push('remove');
      i++;
    } else {
      ops.push('add');
      j++;
    }
  }
  while (i < n) {
    ops.push('remove');
    i++;
  }
  while (j < m) {
    ops.push('add');
    j++;
  }
  return ops;
}

function internIds(a: string[], b: string[]): [number[], number[]] {
  const ids = new Map<string, number>();
  const toId = (value: string) => {
    let id = ids.get(value);
    if (id === undefined) {
      id = ids.size;
      ids.set(value, id);
    }
    return id;
  };
  return [a.map(toId), b.map(toId)];
}

/** Destaque por palavra entre duas linhas reescritas. */
export function diffWords(
  before: string,
  after: string,
): { before: DiffSegment[]; after: DiffSegment[] } | null {
  const a = before.split(/(\s+)/).filter((token) => token !== '');
  const b = after.split(/(\s+)/).filter((token) => token !== '');
  if (a.length > MAX_WORD_TOKENS || b.length > MAX_WORD_TOKENS) return null;
  const [idsA, idsB] = internIds(a, b);
  const ops = lcsOps(idsA, idsB);

  const beforeSegments: DiffSegment[] = [];
  const afterSegments: DiffSegment[] = [];
  const push = (target: DiffSegment[], text: string, changed: boolean) => {
    const last = target[target.length - 1];
    if (last && last.changed === changed) last.text += text;
    else target.push({ text, changed });
  };
  let i = 0;
  let j = 0;
  for (const op of ops) {
    if (op === 'equal') {
      push(beforeSegments, at(a, i), false);
      push(afterSegments, at(b, j), false);
      i++;
      j++;
    } else if (op === 'remove') {
      push(beforeSegments, at(a, i), true);
      i++;
    } else {
      push(afterSegments, at(b, j), true);
      j++;
    }
  }
  return { before: beforeSegments, after: afterSegments };
}

/** Liga, em cada bloco "removidas seguidas de adicionadas", a i-ésima de uma à i-ésima da outra. */
function annotateRewrites(lines: DiffLine[]): void {
  let index = 0;
  while (index < lines.length) {
    if (at(lines, index).op === 'equal') {
      index++;
      continue;
    }
    const start = index;
    while (index < lines.length && at(lines, index).op === 'remove') index++;
    const removedEnd = index;
    while (index < lines.length && at(lines, index).op === 'add') index++;
    const removed = lines.slice(start, removedEnd);
    const added = lines.slice(removedEnd, index);
    const pairs = Math.min(removed.length, added.length);
    for (let k = 0; k < pairs; k++) {
      const words = diffWords(at(removed, k).text, at(added, k).text);
      if (!words) continue;
      // Linhas sem nada em comum seriam só ruído: melhor o destaque da linha inteira.
      const sharesWords = words.before.some((s) => !s.changed && s.text.trim() !== '');
      if (!sharesWords) continue;
      at(removed, k).segments = words.before;
      at(added, k).segments = words.after;
    }
    if (index === start) index++;
  }
}

export function diffLines(before: string, after: string): TextDiff {
  const a = splitLines(before);
  const b = splitLines(after);

  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix++;
  }

  const midA = a.slice(prefix, a.length - suffix);
  const midB = b.slice(prefix, b.length - suffix);

  let approximate = false;
  let midOps: DiffOp[];
  if (midA.length === 0) midOps = midB.map(() => 'add');
  else if (midB.length === 0) midOps = midA.map(() => 'remove');
  else if ((midA.length + 1) * (midB.length + 1) > MAX_LCS_CELLS) {
    approximate = true;
    midOps = [...midA.map((): DiffOp => 'remove'), ...midB.map((): DiffOp => 'add')];
  } else {
    midOps = lcsOps(...internIds(midA, midB));
  }

  const lines: DiffLine[] = [];
  let oldNumber = 1;
  let newNumber = 1;
  const pushEqual = (text: string) =>
    lines.push({ op: 'equal', text, oldNumber: oldNumber++, newNumber: newNumber++ });

  for (let k = 0; k < prefix; k++) pushEqual(at(a, k));
  let i = 0;
  let j = 0;
  let added = 0;
  let removed = 0;
  for (const op of midOps) {
    if (op === 'equal') {
      pushEqual(at(midA, i));
      i++;
      j++;
    } else if (op === 'remove') {
      lines.push({ op, text: at(midA, i), oldNumber: oldNumber++, newNumber: null });
      removed++;
      i++;
    } else {
      lines.push({ op, text: at(midB, j), oldNumber: null, newNumber: newNumber++ });
      added++;
      j++;
    }
  }
  for (let k = a.length - suffix; k < a.length; k++) pushEqual(at(a, k));

  annotateRewrites(lines);
  return { lines, added, removed, approximate };
}

export type DiffItem =
  { kind: 'line'; line: DiffLine } | { kind: 'gap'; id: string; hidden: DiffLine[] };

/**
 * Colapsa trechos iguais longos, mantendo `context` linhas ao redor de cada mudança.
 * Sem nenhuma mudança, devolve tudo como linhas (quem chama decide o estado vazio).
 */
export function collapseUnchanged(lines: DiffLine[], context = 3): DiffItem[] {
  const keep = new Array<boolean>(lines.length).fill(false);
  let hasChange = false;
  lines.forEach((line, index) => {
    if (line.op === 'equal') return;
    hasChange = true;
    for (
      let k = Math.max(0, index - context);
      k <= Math.min(lines.length - 1, index + context);
      k++
    )
      keep[k] = true;
  });
  if (!hasChange) return lines.map((line) => ({ kind: 'line', line }));

  const items: DiffItem[] = [];
  let hidden: DiffLine[] = [];
  const flush = (position: number) => {
    // Esconder uma única linha economiza menos espaço do que o botão ocupa.
    if (hidden.length === 1) items.push({ kind: 'line', line: at(hidden, 0) });
    else if (hidden.length > 1) items.push({ kind: 'gap', id: `gap-${position}`, hidden });
    hidden = [];
  };
  lines.forEach((line, index) => {
    if (keep[index]) {
      flush(index);
      items.push({ kind: 'line', line });
    } else hidden.push(line);
  });
  flush(lines.length);
  return items;
}

/** Palavras separadas por espaço em branco, para o resumo de tamanho de cada versão. */
export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}
