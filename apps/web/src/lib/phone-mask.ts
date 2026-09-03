/**
 * Máscara de telefone brasileira "(DDD) número" — usada na tela "Minha Conta".
 *
 * O backend só fala E.164 puro (`phoneE164Schema` em `@movivo/shared`, ex.:
 * `+5511999999999`) — a máscara é só apresentação, nunca o formato armazenado/enviado.
 */

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

/**
 * Extrai DDD + número local de qualquer string (E.164 vindo da API, ou o que o usuário
 * já digitou). Só remove o prefixo `55` quando os dígitos excedem DDD+número (11), senão
 * um DDD legítimo `55` (Rio Grande do Sul) seria cortado por engano.
 */
function localDigits(value: string): string {
  const digits = digitsOnly(value);
  const withoutCountryCode =
    digits.startsWith('55') && digits.length > 11 ? digits.slice(2) : digits;
  return withoutCountryCode.slice(0, 11);
}

/**
 * Formata progressivamente como `(DDD) NNNNN-NNNN` (celular) ou `(DDD) NNNN-NNNN` (fixo)
 * — a virada pro grupo de 5 dígitos acontece sozinha assim que o 9º dígito do número
 * local é digitado, então funciona bem tanto para digitação livre quanto para valor
 * já preenchido (ex.: ao carregar o perfil).
 */
export function maskBrazilianPhone(value: string): string {
  const digits = localDigits(value);
  if (digits.length === 0) return '';
  if (digits.length <= 2) return `(${digits}`;

  const ddd = digits.slice(0, 2);
  const rest = digits.slice(2);
  if (rest.length <= 4) return `(${ddd}) ${rest}`;
  if (rest.length <= 8) return `(${ddd}) ${rest.slice(0, 4)}-${rest.slice(4)}`;
  return `(${ddd}) ${rest.slice(0, 5)}-${rest.slice(5, 9)}`;
}

/** Converte o valor mascarado de volta para E.164 (`+55` + DDD + número), pro backend. */
export function toE164BrazilianPhone(masked: string): string {
  return `+55${localDigits(masked)}`;
}
