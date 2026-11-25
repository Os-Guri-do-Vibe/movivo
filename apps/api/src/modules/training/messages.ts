/**
 * Texto do link diário. Guardrails: fala de treino registrado e de acompanhamento com a
 * metodologia dos profissionais, nunca de diagnóstico, tratamento ou resultado garantido, e
 * sem culpa pelo que não foi feito.
 */
import { whatsappBold as bold } from '../../core/text/whatsapp-format';
import { WHATSAPP_BUBBLE_SEPARATOR } from '../jobs/whatsapp-outbound.contract';

export function greetingFor(localTime: string): string {
  const hour = Number(localTime.slice(0, 2));
  if (hour >= 18 || hour < 4) return 'Boa noite';
  return hour < 12 ? 'Bom dia' : 'Boa tarde';
}

/** "Musculação e Corrida" a partir dos títulos das sessões do dia. */
export function listTitles(titles: readonly string[]): string {
  if (titles.length <= 1) return titles[0] ?? '';
  return `${titles.slice(0, -1).join(', ')} e ${titles.at(-1)}`;
}

export function dailyLinkMessage(
  firstName: string,
  titles: readonly string[],
  link: string,
  greeting: string,
): string {
  return [
    `${greeting}, ${bold(firstName)}! Hoje no seu plano: ${bold(listTitles(titles))}.`,
    `Abra aqui para ver o treino e registrar quando terminar: ${link}`,
    'Se o dia apertou, tudo bem: conta pra gente e a gente ajusta a semana.',
  ].join(WHATSAPP_BUBBLE_SEPARATOR);
}
