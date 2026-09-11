/**
 * PII Scrubber determinístico no boundary de entrada (US-2.2 / TASK-2.2.1 · Victor §5.1 · Sato §5.2).
 *
 * Roda **antes** de qualquer chamada ao LLM e é a única porta do `LLMRouter`. Nenhum
 * identificador direto (nome, telefone, e-mail, CPF, nascimento) chega ao provedor; o
 * snapshot logado em `ai_jobs.input_snapshot` é sempre a versão pseudonimizada.
 *
 * Determinístico e <10ms: substituição precisa a partir do `users` + regex. Pseudonimizar
 * também corta tokens (bônus de custo — Eduardo). Defense-in-depth: isto **e** o provedor
 * ZDR — nenhum dos dois sozinho basta.
 *
 * Achado 2026-09-08 (bug reproduzido ao vivo pelo fundador): existiu aqui uma heurística de
 * "menção a terceiro" (token capitalizado após "do/da/de" virava "terceiro") — mas era só um
 * regex sobre capitalização, não NER, e disparava em qualquer nome de exercício composto
 * ("Caminhada de Mala" → "Caminhada de terceiro"), corrompendo tanto o texto que o LLM recebe
 * quanto a conversa exibida no painel do profissional. Removida por decisão do fundador: a
 * plataforma de profissionais é de uso interno da MOVIVO, não precisa desse nível de
 * anonimização, e nenhum benefício reaproveitando a heurística compensava o risco de dado
 * corrompido chegar ao modelo ou ao profissional decidindo sobre a saúde do aluno.
 */
import type { ScrubUser } from './llm.types';

const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
// E.164 e formatos BR comuns (com/sem +55, DDD, hífen, parênteses).
const PHONE = /\+?\d{0,3}[\s.-]?\(?\d{2,3}\)?[\s.-]?\d{4,5}[\s.-]?\d{4}/g;
const CPF = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;
const DATE = /\b(\d{2}[/.]\d{2}[/.]\d{2,4}|\d{4}-\d{2}-\d{2})\b/g;

/** Partes do corpo reconhecidas para normalizar lesão em rótulo estável. */
const BODY_PARTS = [
  'ombro',
  'joelho',
  'coluna',
  'lombar',
  'cervical',
  'punho',
  'cotovelo',
  'tornozelo',
  'quadril',
  'pescoço',
  'costas',
  'panturrilha',
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Partículas de nome (preposição/artigo) que NUNCA viram token isolado de substituição —
 * achado 2026-09-10 (bug reportado pelo fundador, reproduzido ao vivo): "Rodrigo Cavalcante
 * de Barros" fazia todo "de" do texto virar "o usuário" ("a vontade de ir treinar" → "a
 * vontade o usuário ir treinar"), porque o nome completo era tokenizado palavra a palavra sem
 * excluir conectores comuns da língua portuguesa. Sobrenome com partícula ("de", "da", "do",
 * "dos", "das", "e") é comum em nome brasileiro, não é caso de borda — substituir só o
 * conector, sozinho, nunca remove PII de verdade (ele não identifica ninguém) e corrompe
 * qualquer prosa comum que o atravesse.
 */
const NAME_PARTICLES = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);

/**
 * Normaliza descrições de lesão para um rótulo estável e sem PII:
 *   "lesão no ombro direito do João" → "lesão: ombro D"
 * Reduz variância (menos tokens) e derruba naturalmente nomes de terceiros na frase.
 */
function normalizeInjury(text: string): string {
  return text.replace(/les(?:ã|a)o[^.\n]*/gi, (segment) => {
    const lower = segment.toLowerCase();
    const part = BODY_PARTS.find((p) => lower.includes(p));
    if (!part) return segment;
    const side = /\bdireit[oa]\b/.test(lower) ? ' D' : /\besquerd[oa]\b/.test(lower) ? ' E' : '';
    return `lesão: ${part}${side}`;
  });
}

/**
 * Remove/substitui identificadores diretos por rótulos estáveis. `user` fornece os
 * valores exatos conhecidos do titular (substituição precisa); o resto é regex.
 */
export function scrubPII(text: string, user: ScrubUser): string {
  if (!text) return text;
  let out = normalizeInjury(text);

  // Substituição precisa a partir do `users` (o telefone/e-mail/nome são conhecidos).
  if (user.email) out = out.replaceAll(user.email, '[email]');
  if (user.phoneNumber) out = out.replaceAll(user.phoneNumber, '[telefone]');
  if (user.birthDate) out = out.replaceAll(user.birthDate, '[data]');
  if (user.name) {
    for (const token of user.name.split(/\s+/).filter((t) => t.length >= 2)) {
      if (NAME_PARTICLES.has(token.toLowerCase())) continue;
      out = out.replace(new RegExp(`\\b${escapeRegExp(token)}\\b`, 'gi'), 'o usuário');
    }
  }

  // Regex genérico para o que não veio do `users` (campo livre, terceiros).
  out = out.replace(EMAIL, '[email]');
  out = out.replace(CPF, '[cpf]');
  out = out.replace(DATE, '[data]');
  out = out.replace(PHONE, (m) => (/\d{8,}/.test(m.replace(/\D/g, '')) ? '[telefone]' : m));

  return out;
}
