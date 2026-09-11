/**
 * Guardrail clínico de entrada (US-3.4, Etapa 0) — regex <1ms ANTES de qualquer custo de IA.
 *
 * Fail-safe clínico: detecta sinais de **alto risco** e curto-circuita para `FORA_DE_ESCOPO`
 * sem pagar embedding/LLM. Dois níveis, alinhados à decisão do fundador (2026-07-30):
 *  - `SAFETY`: dor grave / emergência / automutilação → handoff de segurança clínica (orienta
 *    atendimento presencial imediato + alerta prioritário).
 *  - `SCOPE`: pergunta fora do escopo do coach (medicamento/dopagem, clínico, finanças,
 *    política, crime, pedido genérico de IA) → recusa honesta, **sem** handoff humano.
 *
 * ponytail: heurística de regex, sem NER — teto reconhecido; a rede de segurança final é o
 * `ValidationService` (US-2.3) sobre a saída. Termos a validar pelo RT CREF/Alexandre.
 */
import { canonicalizeSecurityText } from '../../../core/agent-config/text-normalize';

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
 * v3 (2026-09-10, a pedido do fundador — ver memória `rt-leo-credenciais-escopo`): o
 * perímetro deixou de ser só treino/evolução/performance e passou a incluir o que um
 * personal trainer de verdade conversaria com o aluno — vida pessoal, sono, hábitos,
 * bem-estar, saúde emocional e orientação BÁSICA de alimentação (não mais bloqueadas aqui;
 * a linha entre "básico" e "prescrição individualizada" é responsabilidade do prompt do LLM,
 * `SCOPE_PERIMETER_BLOCK`, não desta heurística). O que continua hard-bloqueado, mesmo em
 * papo casual, é o que segue sendo claramente fora do papel de um personal trainer:
 * medicamento/dopagem, outras áreas clínicas (dermato, ginecologia), finanças, política,
 * crime, e pedidos genéricos de IA/tentativa de trocar de papel. As categorias abaixo cobrem
 * os desvios mais baratos de pegar por regex antes de gastar embedding/LLM; o resto cai no
 * kNN (`intent-examples.seed.ts`) e no fail-safe do classificador (rótulo desconhecido →
 * FORA_DE_ESCOPO). ponytail: regex de palavra-chave, não NLU — falso-negativo aqui não é
 * falha de segurança, só custo de um LLM a mais com o mesmo guardrail no prompt.
 */
const SCOPE_PATTERNS: RegExp[] = [
  // --- medicamento / dopagem (hard-exclusão mesmo em papo casual) ---
  /\brem[eé]dio\b|\bmedicamento\b|\banti-?inflamat[oó]rio\b/i,
  /\b(dipirona|ibuprofeno|tramadol|rivotril|clonazepam|morfina|omeprazol|antidepressiv[oa])\b/i,
  /\b(anabolizante|est[eé]roide|hor?m[ôo]nio\s+do\s+crescimento|\bgh\b|\bhgh\b|testosterona\s+(sint[eé]tica|inject[aá]vel|ex[óo]gena)|\bdoping\b|dopagem)\b/i,
  /\btermog[eê]nico\b|\bemagrecedor\b/i,
  // --- outras áreas clínicas não relacionadas a treino ---
  /\b(dermatologi|espinha|acne|queda\s+de\s+cabelo|bot[oó]x|preenchiment|lipoaspira|cirurgia\s+pl[áa]stica)/i,
  /\b(anticoncepcion|gravidez|menstrua|fertilidade|dst\b|infec[çc][ãa]o)/i,
  // --- finanças, política ---
  /\b(investir|investiment|a[çc][õo]es\s+da\s+bolsa|bitcoin|cripto|empr[ée]stimo|d[íi]vida|imposto\s+de\s+renda)\b/i,
  /\b(elei[çc][ãa]o|eleitoral|presidente|deputad|partido\s+pol[íi]tico|votar\s+em)\b/i,
  // --- crime / atividade ilegal ---
  /\b(tr[aá]fico\s+de\s+drog|traficar|roubar|\broubo\b|furtar|\bfurto\b|arma\s+ilegal|comprar\s+droga|vender\s+droga)\b/i,
  // --- pedidos genéricos de IA / tentativa de sair do papel de coach de treino ---
  // objeto explícito: "resuma meu progresso" é treino e NÃO pode cair aqui.
  /\b(escrev[ae]|redij[ae]|traduz[ae]?|resum[ae])\s+(um|uma|esse|este|essa)?\s*(texto|e-?mail|artigo|reda[çc][ãa]o|post|legenda|mensagem\s+para)\b/i,
  // "código"/"programação"/"planilha"/"currículo" só bloqueiam quando é PEDIDO de criação
  // genérica (ex.: "monta uma planilha de gastos pra mim"): bare match falso-positivava
  // termos legítimos do próprio produto — achado 2026-09-10 (reproduzido ao vivo): "ainda não
  // consegui olhar a planilha [do treino]" caiu aqui e travou a mensagem inteira em
  // FORA_DE_ESCOPO sem nunca chamar o LLM. Mesmo risco existia com "código" (colide com o
  // código de verificação do WhatsApp) e "programação" (colide com "programação da semana" =
  // divisão/agenda de treino). javascript/python/redação do enem seguem bare match: não têm
  // uso legítimo neste domínio.
  /\b(fa[çc]a|crie|monte|monta|desenvolv[ae]|programe|escrev[ae])\s+(um|uma|esse|este|essa)?\s*(c[óo]digo|programa[çc][ãa]o|script|planilha|curr[íi]culo)\b/i,
  /\b(javascript|python|reda[çc][ãa]o\s+do\s+enem)\b/i,
  /\b(finja|faz\s+de\s+conta|finge)\s+que\s+voc[êe]\b|\besque[çc]a\s+que\s+voc[êe]\s+[ée]\b/i,
  /\bvoc[êe]\s+[ée]\s+(um|uma)\s+(m[ée]dic|nutricionist|advogad|terapeuta)/i,
];

/** `SAFETY` | `SCOPE` | `null` (segue para classificação normal). SAFETY tem prioridade. */
export function clinicalGuardrail(message: string): GuardrailLevel | null {
  const canonical = canonicalizeSecurityText(message);
  if (SAFETY_PATTERNS.some((re) => re.test(canonical))) return 'SAFETY';
  if (SCOPE_PATTERNS.some((re) => re.test(canonical))) return 'SCOPE';
  return null;
}
