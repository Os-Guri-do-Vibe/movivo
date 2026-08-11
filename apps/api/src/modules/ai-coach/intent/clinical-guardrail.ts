/**
 * Guardrail clínico de entrada (US-3.4, Etapa 0) — regex <1ms ANTES de qualquer custo de IA.
 *
 * Fail-safe clínico: detecta sinais de **alto risco** e curto-circuita para `FORA_DE_ESCOPO`
 * sem pagar embedding/LLM. Dois níveis, alinhados à decisão do fundador (2026-07-30):
 *  - `SAFETY`: dor grave / emergência / automutilação → handoff de segurança clínica (orienta
 *    atendimento presencial imediato + alerta prioritário).
 *  - `SCOPE`: pergunta fora do escopo do coach (medicamento, nutrição/suplemento) → recusa
 *    honesta, **sem** handoff humano.
 *
 * ponytail: heurística de regex, sem NER — teto reconhecido; a rede de segurança final é o
 * `ValidationService` (US-2.3) sobre a saída. Termos a validar pelo RT CREF/Alexandre.
 */
export type GuardrailLevel = 'SAFETY' | 'SCOPE';

/** Emergência clínica / risco à vida → handoff de segurança. */
const SAFETY_PATTERNS: RegExp[] = [
  /\bdor\s+no\s+peito\b/i,
  /\baperto\s+no\s+peito\b/i,
  /\bfalta\s+de\s+ar\b/i,
  /\b(t[oô]|estou)\s+passando\s+mal\b/i,
  /\bvou\s+desmaiar\b|\bdesmai/i,
  /\btontura\s+(forte|intensa)\b/i,
  /\bdor\s+(muito\s+)?forte\b/i,
  /\bn[aã]o\s+consigo\s+respirar\b/i,
  /\bme\s+matar\b|\bsuic[ií]d|\bautomutila/i,
];

/**
 * Fora do escopo do coach (não é emergência) → recusa honesta.
 *
 * v2 (2026-08): o perímetro do coach é treino/evolução/performance segura. As categorias
 * abaixo cobrem os desvios mais baratos de pegar por regex antes de gastar embedding/LLM; o
 * resto cai no kNN (`intent-examples.seed.ts`) e no fail-safe do classificador (rótulo
 * desconhecido → FORA_DE_ESCOPO). ponytail: regex de palavra-chave, não NLU — falso-negativo
 * aqui não é falha de segurança, só custo de um LLM a mais com o mesmo guardrail no prompt.
 */
const SCOPE_PATTERNS: RegExp[] = [
  // --- medicamento / suplemento / nutrição (v1) ---
  /\brem[eé]dio\b|\bmedicamento\b|\banti-?inflamat[oó]rio\b/i,
  /\b(dipirona|ibuprofeno|tramadol|rivotril|clonazepam|morfina|omeprazol)\b/i,
  /\bsuplement|\bcreatina\b|\bwhey\b|\btermog[eê]nico\b|\bemagrecedor\b/i,
  /\bdieta\b|\bo\s+que\s+(devo|posso)\s+comer\b|\bcard[aá]pio\b|\bcaloria|\bmacronutriente|\bjejum\s+intermitente\b/i,
  // --- outras áreas de saúde não relacionadas a treino ---
  /\b(dermatologi|espinha|acne|queda\s+de\s+cabelo|celulite|bot[oó]x|preenchiment|lipoaspira|cirurgia\s+pl[áa]stica)/i,
  /\b(anticoncepcion|gravidez|menstrua|fertilidade|dst\b|infec[çc][ãa]o)/i,
  /\b(terapia|psic[oó]log|psiquiatr|antidepressiv|ansiedade\s+generalizada)/i,
  // --- vida pessoal / relacionamento ---
  /\b(namorad[oa]|ex\s+namorad|casamento|term(inei|inar)\s+com|relacionament[oa]\s+(amoroso|t[óo]xico)|conselho\s+amoroso)/i,
  // --- finanças, política, religião, notícias ---
  /\b(investir|investiment|a[çc][õo]es\s+da\s+bolsa|bitcoin|cripto|empr[ée]stimo|d[íi]vida|imposto\s+de\s+renda)\b/i,
  /\b(elei[çc][ãa]o|eleitoral|presidente|deputad|partido\s+pol[íi]tico|votar\s+em)\b/i,
  /\b(religi[ãa]o|deus\s+existe|igreja|hor[óo]scopo|signo)\b/i,
  // --- pedidos genéricos de IA / tentativa de sair do papel de coach de treino ---
  // objeto explícito: "resuma meu progresso" é treino e NÃO pode cair aqui.
  /\b(escrev[ae]|redij[ae]|traduz[ae]?|resum[ae])\s+(um|uma|esse|este|essa)?\s*(texto|e-?mail|artigo|reda[çc][ãa]o|post|legenda|mensagem\s+para)\b/i,
  /\b(c[óo]digo|programa[çc][ãa]o|javascript|python|planilha|curr[íi]culo|reda[çc][ãa]o\s+do\s+enem)\b/i,
  /\b(finja|faz\s+de\s+conta|finge)\s+que\s+voc[êe]\b|\besque[çc]a\s+que\s+voc[êe]\s+[ée]\b/i,
  /\bvoc[êe]\s+[ée]\s+(um|uma)\s+(m[ée]dic|nutricionist|advogad|terapeuta)/i,
];

/** `SAFETY` | `SCOPE` | `null` (segue para classificação normal). SAFETY tem prioridade. */
export function clinicalGuardrail(message: string): GuardrailLevel | null {
  if (SAFETY_PATTERNS.some((re) => re.test(message))) return 'SAFETY';
  if (SCOPE_PATTERNS.some((re) => re.test(message))) return 'SCOPE';
  return null;
}
