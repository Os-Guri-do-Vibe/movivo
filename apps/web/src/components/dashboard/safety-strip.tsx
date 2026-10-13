import { ShieldAlert } from 'lucide-react';
import Link from 'next/link';

/**
 * Faixa de segurança: alerta de SEGURANÇA ainda aberto. Não é uma notificação — é um estado de
 * risco em aberto, por isso continua visível mesmo depois de o alerta ser lido (ler não resolve).
 */
export function SafetyStrip({ count, onNavigate }: { count: number; onNavigate?: () => void }) {
  if (count <= 0) return null;
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-l-4 border-l-coral bg-card px-3 py-2">
      <p className="flex items-center gap-2 text-label font-semibold text-foreground">
        <ShieldAlert aria-hidden="true" className="size-4 shrink-0" />
        {count === 1 ? '1 alerta de segurança aberto' : `${count} alertas de segurança abertos`}
      </p>
      <Link
        href="/dashboard/alertas"
        onClick={onNavigate}
        className="shrink-0 text-label font-medium underline underline-offset-4 focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none"
      >
        Ver alertas
      </Link>
    </div>
  );
}
