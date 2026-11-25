/**
 * Máscaras de entrada da anamnese. Funções puras: recebem o que o navegador acabou de
 * produzir (`input`) e o texto anterior (`previous`) e devolvem o texto mascarado.
 */

const onlyDigits = (text: string) => text.replace(/\D/g, '');

/** Limites de cada campo de um relógio (`hh:mm`, `mm:ss`, `hh:mm:ss`). */
export type ClockFields = readonly number[];

export const CLOCK_HM: ClockFields = [9, 59];
export const CLOCK_SLEEP: ClockFields = [12, 59];
export const CLOCK_HMS: ClockFields = [9, 59, 59];
const CLOCK_MS: ClockFields = [59, 59];

/**
 * Apagar o `:` apaga o dígito anterior: sem isso a máscara recolocaria o separador e o
 * backspace pareceria travado.
 */
function digitsAfterEdit(input: string, previous: string): string {
  const digits = onlyDigits(input);
  if (input.length < previous.length && digits === onlyDigits(previous)) return digits.slice(0, -1);
  return digits;
}

function clockFrom(digits: string, fields: ClockFields): string {
  const parts: string[] = [];
  let index = 0;
  let partial = false;
  for (const max of fields) {
    if (index >= digits.length) break;
    const first = digits.charAt(index);
    if (Number(first) * 10 > max) {
      // "7" em minutos só pode ser "07": o campo fecha sozinho.
      parts.push(`0${first}`);
      index += 1;
    } else if (index + 1 < digits.length) {
      parts.push(String(Math.min(Number(first + digits.charAt(index + 1)), max)).padStart(2, '0'));
      index += 2;
    } else {
      parts.push(first);
      index += 1;
      partial = true;
    }
  }
  const text = parts.join(':');
  const complete = !partial && parts.length < fields.length && index >= digits.length;
  return complete && parts.length > 0 ? `${text}:` : text;
}

/** Relógio com separadores automáticos (`hh:mm`, `hh:mm:ss`…), campo a campo. */
export function maskClock(input: string, previous: string, fields: ClockFields): string {
  return clockFrom(digitsAfterEdit(input, previous).slice(0, fields.length * 2), fields);
}

/**
 * Tempo de prova: até 4 dígitos é `mm:ss`; a partir do 5º dígito vira `h:mm:ss`
 * (ex.: 10530 → 1:05:30).
 */
export function maskRaceTime(input: string, previous: string): string {
  const digits = digitsAfterEdit(input, previous).slice(0, 6);
  if (digits.length <= 4) return clockFrom(digits, CLOCK_MS);
  const split = digits.length - 4;
  const minutes = String(Math.min(Number(digits.slice(split, split + 2)), 59)).padStart(2, '0');
  const seconds = String(Math.min(Number(digits.slice(split + 2)), 59)).padStart(2, '0');
  return `${Number(digits.slice(0, split))}:${minutes}:${seconds}`;
}

/** Número com no máximo `decimals` casas; aceita `,` ou `.` e normaliza para `.`. */
export function maskNumber(input: string, maxInteger: number, decimals: number): string {
  const cleaned = input.replace(/[^\d.,]/g, '').replace(',', '.');
  const [integer = '', ...rest] = cleaned.split('.');
  const head = integer.slice(0, maxInteger);
  if (decimals === 0 || rest.length === 0) return head;
  return `${head}.${rest.join('').slice(0, decimals)}`;
}

/** Centavos de um texto digitado: só dígitos, sem zeros à esquerda e até R$ 9.999.999,99. */
export function currencyDigits(input: string): string {
  return onlyDigits(input)
    .slice(0, 9)
    .replace(/^0+(?=\d)/, '');
}

/** Reais digitados como centavos: "15000" vira `R$ 150,00` (casas decimais já na digitação). */
export function maskCurrency(input: string): string {
  const digits = onlyDigits(input)
    .slice(0, 9)
    .replace(/^0+(?=\d)/, '');
  if (digits === '') return '';
  const padded = digits.padStart(3, '0');
  const cents = padded.slice(-2);
  const reais = padded.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `R$ ${reais},${cents}`;
}

/** `hh:mm` → minutos, `hh:mm:ss` → segundos (cada campo vale 60 do seguinte). */
export function clockToTotal(text: string): number | undefined {
  const parts = text.trim().split(':');
  if (parts.length === 0 || parts.some((part) => part === '' || !/^\d+$/.test(part))) {
    return undefined;
  }
  return parts.map(Number).reduce((total, part) => total * 60 + part, 0);
}

/** Minutos → `hh:mm`. */
export function minutesToClock(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  return `${String(hours).padStart(2, '0')}:${String(Math.round(minutes % 60)).padStart(2, '0')}`;
}

/** Segundos → `hh:mm:ss`. */
export function secondsToClock(seconds: number): string {
  const rest = Math.round(seconds);
  const hours = Math.floor(rest / 3600);
  const minutes = Math.floor((rest % 3600) / 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(rest % 60).padStart(2, '0')}`;
}

/** Segundos → `mm:ss`, ou `h:mm:ss` a partir de uma hora (tempo de prova). */
export function secondsToRaceTime(seconds: number): string {
  const rest = Math.round(seconds);
  const hours = Math.floor(rest / 3600);
  const minutes = Math.floor((rest % 3600) / 60);
  const secs = String(rest % 60).padStart(2, '0');
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${secs}`
    : `${String(minutes).padStart(2, '0')}:${secs}`;
}
