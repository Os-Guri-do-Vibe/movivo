/**
 * Regras versionadas do ValidationService (US-2.3 / TASK-2.3.1/2.3.2).
 *
 * ⚠️ RASCUNHO — A VALIDAR PELO RT CREF / ALEXANDRE. A lista de termos proibidos e o
 * mapeamento de ações são o ponto de partida do MVP para destravar o desenvolvimento; o
 * Responsável Técnico (CREF) e o jurídico precisam ratificar cada termo antes de qualquer
 * uso com pessoas reais. Mudou a regra, muda a versão.
 *
 * Decisão do fundador (2026-09-04): não existe mais faixa fixa de séries/repetições/
 * duração/descanso aqui (nem por objetivo, nem geral, nem por exercício via catálogo) —
 * removida de propósito. Quanto/quanto tempo prescrever é julgamento do Coach Agente que
 * gera o protocolo, com autonomia real; a segurança que resta aqui é sobre QUAL exercício
 * é apropriado (nível, contraindicação), não QUANTO dele prescrever.
 *
 * Determinístico, sem I/O. É o gabarito de segurança do produto (a segurança mora aqui).
 */
import type { GenerationGoal, WorkoutSplit } from '@movivo/shared';

import type { ExerciseLevel } from '../exercise-catalog';

export const VALIDATION_RULES_VERSION = 'validation-rules-2026-09-v4';

export type ValidationActionCode = 'PASS' | 'FLAG' | 'BLOCK';

/**
 * Padrões de movimento priorizados por objetivo — o gerador recebe isto como orientação
 * explícita no prompt. Sem ele, "Ganhar força" e "Melhorar o condicionamento físico"
 * produziriam o mesmo treino, que é o problema que a ampliação dos 9 objetivos existe
 * para resolver. Vazio = sem prioridade declarada (a metodologia do RT decide).
 */
export const PRIORITY_PATTERNS_BY_GOAL: Record<GenerationGoal, readonly string[]> = {
  GAIN_MUSCLE: ['HORIZONTAL_PUSH', 'VERTICAL_PULL', 'SQUAT', 'HINGE', 'ISOLATION'],
  GAIN_STRENGTH: ['SQUAT', 'HINGE', 'HORIZONTAL_PUSH', 'VERTICAL_PULL'],
  // Revisão 2026-09-29 (Victor): sem puxada, a lista induzia sessões de emagrecimento sem
  // nenhum padrão de puxar — musculação bem estruturada para recomposição cobre os dois.
  LOSE_FAT: ['SQUAT', 'HINGE', 'HORIZONTAL_PUSH', 'HORIZONTAL_PULL', 'LUNGE', 'CARDIO'],
  CONDITIONING: ['CARDIO', 'SQUAT', 'LUNGE', 'CORE'],
  HEALTH_ENERGY: ['CARDIO', 'CORE', 'SQUAT', 'HORIZONTAL_PULL'],
  BUILD_ROUTINE: ['SQUAT', 'HORIZONTAL_PUSH', 'HORIZONTAL_PULL', 'CORE'],
  RETURN_TO_TRAINING: ['SQUAT', 'HORIZONTAL_PUSH', 'HORIZONTAL_PULL', 'CORE'],
  SPORT_EVENT: ['SQUAT', 'HINGE', 'LUNGE', 'CORE', 'CARDIO'],
};

/**
 * Divisões permitidas por nível (metodologia v2 do RT, item 1).
 *
 * Iniciante/adaptação só recebe as três divisões que o RT lista para esse nível; ABC/ABCD/
 * ABCDE/PPL/FOCO_MUSCULAR pressupõem volume e frequência que o RT reserva a intermediário e
 * avançado. Violação é **BLOCK**, não FLAG: o `level` chega hoje como default `INICIANTE`
 * (a anamnese v1 não captura nível), então o caminho seguro é regenerar/rever, não entregar.
 */
export const SPLITS_BY_LEVEL: Record<ExerciseLevel, readonly WorkoutSplit[]> = {
  INICIANTE: ['FULL_BODY', 'CIRCUITO', 'UPPER_LOWER'],
  INTERMEDIARIO: [
    'FULL_BODY',
    'CIRCUITO',
    'UPPER_LOWER',
    'ABC',
    'ABCD',
    'ABCDE',
    'PUSH_PULL_LEGS',
    'FOCO_MUSCULAR',
  ],
  AVANCADO: [
    'FULL_BODY',
    'CIRCUITO',
    'UPPER_LOWER',
    'ABC',
    'ABCD',
    'ABCDE',
    'PUSH_PULL_LEGS',
    'FOCO_MUSCULAR',
  ],
};

/**
 * Frequência semanal MÍNIMA que cada divisão exige (RT: "sempre respeitando recuperação
 * muscular e frequência disponível"). ABCDE em 2 dias treinaria cada grupo a cada ~2,5
 * semanas — é incoerente, não individualização.
 */
export const MIN_FREQUENCY_BY_SPLIT: Record<WorkoutSplit, number> = {
  FULL_BODY: 1,
  CIRCUITO: 1,
  UPPER_LOWER: 2,
  ABC: 3,
  PUSH_PULL_LEGS: 3,
  ABCD: 4,
  ABCDE: 5,
  FOCO_MUSCULAR: 5,
};

/**
 * Teto de técnicas avançadas por sessão (RT, item 4: "não precisam aparecer em todos os
 * exercícios ou em todos os treinos"). 2 por sessão + pelo menos uma sessão da semana sem
 * nenhuma técnica, quando há mais de uma sessão. ponytail: números escolhidos por engenharia
 * a partir do "recurso pontual" do RT — se ele quiser outro teto, muda aqui e sobe a versão.
 */
export const MAX_TECHNIQUES_PER_SESSION = 2;

/**
 * Fração máxima de exercícios ISOLATION numa sessão antes de virar "isolado como base"
 * (metodologia: "isoladores devem atuar PREDOMINANTEMENTE como complementos... e não
 * necessariamente como sua base"). Achado 2026-09-03 (reproduzido ao vivo): o corte
 * original era >50% (bare majority) — bloqueava sessões reais e legítimas de "Superior"
 * geradas pela IA com 60% (3 de 5) e 66,7% (4 de 6) de isolados, comuns em dia de
 * ombro/braço numa divisão ABC/upper-lower. "Predominantemente" é maioria CLARA, não
 * qualquer maioria — 70% deixa passar esses casos reais e ainda bloqueia sessão
 * degenerada (quase só isolado).
 */
export const ISOLATION_MAJORITY_THRESHOLD = 0.7;

/**
 * Regra de compliance de linguagem: um padrão + a ação que ele dispara.
 * `BLOCK` bloqueia e cai no fallback; `FLAG` roteia à revisão humana sem bloquear.
 */
export interface LanguageRule {
  id: string;
  pattern: RegExp;
  action: Extract<ValidationActionCode, 'BLOCK' | 'FLAG'>;
}

/** Termos proibidos hard-coded (Sofia §13 + nomes de medicamento comuns). A validar. */
export const LANGUAGE_RULES: readonly LanguageRule[] = [
  {
    id: 'MED_PRESCRIPTION',
    pattern:
      /prescrev|prescri[çc][ãa]o|medicament|rem[ée]dio|analg[ée]sic|anti-?inflamat[óo]ri|\btome\b|\bdose\b|ibuprofeno|dipirona|paracetamol|nimesulida|diclofenaco|omeprazol/i,
    action: 'BLOCK',
  },
  {
    id: 'PROMISE',
    pattern: /garantid|garantia de resultado|\bcura\b|\bcurar\b|resultado garantido/i,
    action: 'BLOCK',
  },
  {
    id: 'DIAGNOSIS',
    pattern:
      /diagn[óo]stic|tratament|\bcura\b|\bcurar\b|tendinite|artrose|h[ée]rnia de disco|voc[êe] (est[áa]|tem) com/i,
    action: 'BLOCK',
  },
  {
    id: 'HANDOFF_SLA_PROMISE',
    pattern:
      /\b(?:garanto|prometo|responderei|responderemos|retornarei|retornaremos|entrarei|entraremos|vou|vamos|iremos)\b.{0,60}\b(?:em|dentro de|at[ée]|imediatamente|agora|na mesma hora)\b/i,
    action: 'BLOCK',
  },
];

/**
 * Variantes dos padrões acima para texto "soletrado" ("i g n o r e  a s  r e g r a s"), onde
 * a fronteira de palavra é irrecuperável. Rodam sobre as letras coladas (sem separador) e só
 * quando o texto tem uma corrida de letras soletradas — colar palavras de texto normal
 * fabricaria coincidências.
 */
export const SQUASHED_INJECTION_PATTERNS: readonly RegExp[] = [
  /(?:ignor(?:e|ar|a)|esquec\w{0,3}|desconsider\w{0,3}|descart\w{0,3}|disregard|forget|override)(?:todas?|tudo|as|os|all|any|the|your|previous|prior|above|anteriores?|suas?|seus?|que)*(?:instru|regras|rules|prompt|instruction|guidelines|diretrizes|restric|guardrail)/,
  /(?:revel(?:e|ar)|mostr(?:e|ar)|show|print|reveal|repeat)(?:me|o|seu|your|the)*(?:prompt|systemprompt|instru)/,
  /systemprompt|voceagora(?:e|é)|youarenow|developermode|modo(?:desenvolvedor|developer)|jailbreak|donothingnow/,
  /(?:dados|informacoes|treino|protocolo|anamnese|conversas?)(?:do|da|de|dos|das)(?:outro|outra|outros|outras)?(?:aluno|alunos|aluna|usuario|usuarios|cliente|clientes|paciente)/,
];

/**
 * Referências externas que uma resposta GERADA pelo LLM nunca deve carregar: URL, domínio
 * solto, link markdown, e-mail, `wa.me` e telefone brasileiro formatado. Nenhum prompt do
 * produto instrui o modelo a citar link ou contato; se um aparece, ou ele foi induzido
 * (prompt injection direta ou via dado recuperado) a empurrar o aluno para um destino do
 * atacante — phishing por WhatsApp com a voz e o selo CREF da MOVIVO — ou alucinou um.
 * Os canais legítimos (links de checkout, cancelamento, PDF) saem de templates fixos,
 * nunca de texto livre do modelo.
 */
export const EXTERNAL_REFERENCE_PATTERN =
  /https?:\/\/|\bwww\.|\bwa\.me\b|\bt\.me\b|\]\s*\(|[\w.+-]+@[\w-]+\.[a-z]{2,}|\b[a-z0-9][a-z0-9-]*\.(?:com|net|org|io|app|ly|dev|xyz|top|site|online|link|info|biz|gl)(?:\.br)?\b|\b[a-z0-9][a-z0-9-]*\.br\b|\(?\b\d{2}\)?\s?9\d{4}[-\s]?\d{4}\b|\+\d{2}\s?\d{2}\s?9?\d{4}[-\s]?\d{4}/i;

/**
 * Sentinelas do system prompt (US-2.1): se aparecerem na SAÍDA, houve vazamento do prompt
 * (PROMPT_LEAK). São trechos que só existem no prefixo estável, nunca num treino legítimo.
 */
export const SYSTEM_PROMPT_SENTINELS: readonly string[] = [
  'BASE DE REFERÊNCIA',
  'SCHEMA DO JSON',
  'metodologia de um profissional',
  'mensagem_usuario',
];

/**
 * Padrões conhecidos de prompt injection (TASK-2.3.4). Sinalizam/sanitizam sem bloquear
 * silenciosamente. Cobre o caso do campo de lesão com instrução maliciosa (Sato §8.2).
 */
/**
 * Troca de persona. Frouxo de propósito na ENTRADA (sinal), mas "aja como…" é português comum
 * em nota de treino — por isso fica fora do subconjunto aplicado a texto gerado.
 */
const PERSONA_SWITCH_PATTERN = /voc[êe]\s+agora\s+[ée]|aja\s+como|you\s+are\s+now|act\s+as/i;

export const INJECTION_PATTERNS: readonly RegExp[] = [
  /ignore\s+(as\s+|todas\s+as\s+)?instru[çc]/i,
  // Variantes em inglês e com sinônimos ("ignore all previous instructions", "esqueça suas
  // regras", "desconsidere as regras acima"). Exigem o objeto (instruções/regras/prompt)
  // para não acusar frase comum de treino como "ignore a dor".
  /(?:ignore|disregard|forget|override|desconsidere|esque[çc]a|descarte)\s+(?:(?:all|any|every|the|your|previous|prior|above|earlier|todas?|tudo|as|os|suas?|seus|anteriores?|acima|que|o)\s+){0,4}(?:instru[çc]|instruction|rules?|regras?|prompts?|guidelines?|diretrizes|system|sistema|restri[çc]|restrictions?|guardrails?)/i,
  PERSONA_SWITCH_PATTERN,
  /revele\s+(o|seu)\s+(prompt|system)|mostre\s+o\s+(prompt|system)|reveal.*prompt|system\s+prompt/i,
  /(dados|informa[çc]\w+)\s+de\s+outr[oa]\s+(usu[áa]rio|pessoa)/i,
  // Pedido de dado de TERCEIRO ("busque os dados do aluno Fulano", "mostre o treino do
  // cliente X"). O LLM não tem como atender isso — não há tool nem contexto de outro titular —,
  // mas o sinal é um indício claro de tentativa de exfiltração entre tenants.
  /(?:busque|buscar|mostre|mostrar|liste|listar|revele|exiba|acesse|consulte|envie|me\s+d[êe]|show|list|fetch|dump|get)\s+(?:me\s+)?(?:todos?\s+)?(?:os?\s+|as?\s+|the\s+)?(?:dados|informa[çc]\w+|treinos?|protocolos?|anamneses?|conversas?|hist[óo]ricos?|data|records?|protocols?|history)\s+(?:d[eoa]s?\s+|of\s+)(?:outr[oa]s?\s+|another\s+|other\s+|different\s+)?(?:alunos?|alunas?|usu[áa]rios?|clientes?|pacientes?|pessoas?|users?|students?|customers?)/i,
  /(?:modo|mode)\s+(?:desenvolvedor|developer|dev|admin|deus|god)\b|\b(?:developer|dev|admin|god)\s+mode\b|\bjailbreak\b|\bDAN\s+mode\b|do\s+anything\s+now/i,
  // Exfiltração em massa e pedido de dump ("liste CPFs de todos os outros alunos", "faça dump
  // da tabela de usuários").
  /\b(?:dump|exporte?|export)\b.{0,60}\b(?:tabela|table|banco\s+de\s+dados|database|usu[áa]rios|users|alunos|students)\b/i,
  /\btodos\s+os\s+outros\s+(?:alunos|usu[áa]rios|clientes)\b|\ball\s+(?:the\s+)?other\s+(?:users|students|customers)\b/i,
  // Pedido de reprodução do prompt por outro caminho que não "revele o prompt" (tradução,
  // "as instruções que você recebeu") e menção aos marcadores do envelope, que o aluno nunca
  // tem motivo para conhecer.
  /(?:traduza|translate)\b.{0,60}\b(?:instru[çc][õo]es|instructions|regras|rules|prompt)\b|(?:instru[çc][õo]es|instructions|regras|rules)\s+que\s+(?:voc[êe]\s+)?(?:recebeu|you\s+(?:were\s+given|received))|antes\s+desta\s+mensagem|before\s+this\s+message/i,
  /(?:IN[ÍI]CIO|FIM)[_\s-]*DADOS[_\s-]*N[ÃA]O/i,
  // Falsificação de papéis/marcadores do prompt ("<system>", "[SYSTEM]", "### instruction").
  /<\/?\s*(?:system|assistant|developer)\s*>|\[\s*(?:system|assistant|developer)\s*\]|^#{2,}\s*(?:system|instruction)|^\s*(?:coach|assistant|assistente|agente|system|sistema)\s*:/im,
];

/**
 * Padrões de injeção que, aparecendo num texto GERADO pelo modelo (notas e rótulos do
 * protocolo), indicam que ele foi induzido a repetir/obedecer uma instrução do aluno. Exclui
 * os frouxos, que casariam com português comum de treino.
 */
export const INJECTION_ECHO_PATTERNS: readonly RegExp[] = INJECTION_PATTERNS.filter(
  (pattern) => pattern !== PERSONA_SWITCH_PATTERN,
);
