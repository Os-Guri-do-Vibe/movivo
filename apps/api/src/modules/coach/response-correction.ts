/**
 * Rodada de correção da resposta conversacional barrada pelo `ValidationService`.
 *
 * Achado 2026-10-12 (stress test em produção): toda violação do validador virava, de imediato,
 * a resposta-padrão "prefiro não arriscar uma resposta imprecisa" — mesmo quando o modelo só
 * tinha escorregado numa palavra ("vou te explicar em detalhe", um nome de exercício fora da
 * lista autorizada) e a segunda tentativa, avisada do que errou, sairia limpa. É o mesmo padrão
 * que já reduziu o fallback do protocolo (`violation-feedback.ts`): dizer ao modelo QUAL regra
 * cumprir, em vez de desistir ou repetir o prompt idêntico.
 *
 * Regras de segurança desta mensagem:
 *  - só viaja pelo canal de `system` (autorado em código), nunca pelo canal do aluno;
 *  - cita o CÓDIGO da regra e a instrução fixa — nunca ecoa o texto barrado, que pode ser
 *    justamente o que um atacante induziu o modelo a escrever;
 *  - `PROMPT_LEAK` e `INJECTION_ECHO` NÃO são corrigíveis: indicam vazamento ou obediência a
 *    instrução do aluno, e a resposta-padrão + revisão humana é o desfecho certo;
 *  - uma única rodada. Se a segunda tentativa também for barrada, aí sim vale a resposta-padrão.
 */
import type { ValidationViolation } from '../protocol/validation/validation.service';

/** Instrução fixa por regra corrigível — o "o que cumprir". */
const CORRECTION_HINTS: Readonly<Record<string, string>> = {
  MED_PRESCRIPTION:
    'Não cite remédio, medicamento, dose de nada nem use "prescrição". Se a dúvida for sobre isso, ' +
    'diga que vai encaminhar ao profissional responsável e responda o resto normalmente.',
  PROMISE:
    'Não use "garantido", "garantia" nem "cura/curar" e não prometa resultado: fale de ' +
    'constância e do que depende do aluno.',
  DIAGNOSIS:
    'Não use "diagnóstico", "tratamento" nem "cura", nem nomeie lesão ou doença como se fosse ' +
    'uma avaliação. Fale só de treino e, se houver dor ou risco, oriente avaliação presencial.',
  HANDOFF_SLA_PROMISE:
    'Não prometa prazo, horário nem retorno (nada de "vou te responder em…", "volto até…"). ' +
    'Diga apenas que o pedido fica registrado para o profissional responsável.',
  EXTERNAL_REFERENCE: 'Não inclua link, site, e-mail nem telefone na resposta.',
  MAKEUP_PRESCRIPTION:
    'Não sugira compensar, repor, dobrar nem fazer treino extra, e não mude o dia de nenhum ' +
    'treino. Diga que não precisa compensar, que o caminho é seguir com o treino previsto e que ' +
    'um ajuste de rotina quem avalia é o profissional CREF.',
  RETRO_LOG_CLAIM:
    'Não diga que registrou, anotou ou marcou um treino: o registro só acontece pelo link do ' +
    'dia. Se a pessoa disse que treinou e não registrou, acredite e oriente a registrar os ' +
    'próximos treinos pelo link.',
  BRAND_LEXICON:
    'Não use "preguiça", "falhou", "falhei", "perdeu o treino", "você sumiu" nem "sem ' +
    'desculpa", nem repita essas palavras se a pessoa as usar: reformule (ex.: "dia sem pique"). ' +
    'Fale de constância: ninguém precisa ser perfeito, o que importa é seguir em movimento.',
};

/** Violações que uma segunda tentativa pode resolver. Qualquer outra → resposta-padrão. */
const CORRECTABLE_RULES: ReadonlySet<string> = new Set([
  ...Object.keys(CORRECTION_HINTS),
  'EXERCISE_NOT_ALLOWED',
]);

export const CORRECTION_HEADER =
  'CORREÇÃO OBRIGATÓRIA: a sua resposta anterior a esta mesma mensagem foi barrada pelo ' +
  'validador automático de linguagem. Escreva de novo, no mesmo tom e com o mesmo conteúdo ' +
  'útil, cumprindo:';

/**
 * Bloco de `system` com as instruções de correção, ou `null` quando a violação não é
 * corrigível (nunca tenta de novo diante de vazamento de prompt ou eco de injeção).
 */
export function buildResponseCorrection(
  violations: readonly Pick<ValidationViolation, 'rule'>[],
  allowedExercises?: readonly string[],
): string | null {
  if (violations.length === 0) return null;
  const rules = [...new Set(violations.map((violation) => violation.rule))];
  if (rules.some((rule) => !CORRECTABLE_RULES.has(rule))) return null;

  const lines = rules.map((rule) => {
    if (rule === 'EXERCISE_NOT_ALLOWED') {
      return allowedExercises && allowedExercises.length > 0
        ? `- Cite SOMENTE estes exercícios, pelo nome exato: ${allowedExercises.join('; ')}. ` +
            'Qualquer outro exercício do catálogo deve ficar de fora da resposta.'
        : '- Não cite nenhum exercício pelo nome.';
    }
    return `- ${CORRECTION_HINTS[rule]}`;
  });
  return [CORRECTION_HEADER, ...lines].join('\n');
}
