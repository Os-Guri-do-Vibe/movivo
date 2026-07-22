import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Une classes condicionais (`clsx`) e resolve conflitos de utilitário Tailwind
 * (`tailwind-merge`) — a última classe vence. É o helper padrão do shadcn/ui e o
 * único caminho autorizado para compor `className` nos componentes do design system.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
