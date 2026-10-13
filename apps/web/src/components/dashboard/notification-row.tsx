import { AlertTriangle, ArrowLeftRight, ClipboardCheck, ShieldAlert } from 'lucide-react';
import Link from 'next/link';

import type { NotificationHistoryItem, NotificationItem } from '@/lib/dashboard-types';
import {
  clockTime,
  describeNotification,
  notificationHref,
  outcomeDetail,
  statusChip,
} from '@/lib/notification-copy';
import { elapsed } from '@/lib/relative-time';
import { cn } from '@/lib/utils';

import { StatusBadge } from './control-center-table';
import { UnreadIndicator } from './unread-indicator';

function RowIcon({ item }: { item: NotificationItem }) {
  if (item.type === 'alert') {
    const safety = item.level === 'SAFETY';
    const Icon = safety ? ShieldAlert : AlertTriangle;
    return (
      <span
        aria-hidden="true"
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-full',
          safety
            ? 'bg-destructive text-destructive-foreground'
            : 'bg-secondary text-secondary-foreground',
        )}
      >
        <Icon className="size-4" />
      </span>
    );
  }
  const Icon = item.type === 'protocol' ? ClipboardCheck : ArrowLeftRight;
  return (
    <span
      aria-hidden="true"
      className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground"
    >
      <Icon className="size-4" />
    </span>
  );
}

/**
 * Linha de notificação. `compact` é a do popover do sino (só pendências não lidas); `full` é a
 * do registro, com o chip de estado, o resultado da decisão e a hora absoluta.
 */
export function NotificationRow({
  item,
  variant = 'compact',
  onNavigate,
}: {
  item: NotificationItem | NotificationHistoryItem;
  variant?: 'compact' | 'full';
  onNavigate?: () => void;
}) {
  const { eyebrow, title, detail } = describeNotification(item);
  const history = variant === 'full' && 'status' in item ? item : null;
  const settledDetail = history ? outcomeDetail(history) : null;
  const safetyAccent = variant === 'full' && item.type === 'alert' && item.level === 'SAFETY';
  return (
    <li>
      <Link
        href={notificationHref(item)}
        onClick={onNavigate}
        className={cn(
          'flex min-h-14 items-start gap-3 rounded-lg px-3 py-2.5 hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none',
          variant === 'full' && 'border border-l-4 border-border bg-card',
          safetyAccent && 'border-l-coral',
        )}
      >
        <span className="mt-3 flex w-2 shrink-0 justify-center">
          <UnreadIndicator read={item.read} />
        </span>
        <RowIcon item={item} />
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-medium text-muted-foreground">{eyebrow}</span>
          <span
            className={cn(
              'block text-label text-foreground',
              item.read ? 'font-medium' : 'font-semibold',
            )}
          >
            {title}
          </span>
          <span
            className={cn(
              'mt-0.5 block text-xs text-muted-foreground',
              variant === 'full' ? 'line-clamp-2' : 'truncate',
            )}
          >
            {settledDetail ? `${detail.split(' · ')[0]} · ${settledDetail}` : detail}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1.5">
          <time
            dateTime={item.createdAt}
            title={new Date(item.createdAt).toLocaleString('pt-BR')}
            className="text-xs text-muted-foreground"
          >
            {variant === 'full' ? clockTime(item.createdAt) : elapsed(item.createdAt)}
          </time>
          {history ? (
            <StatusBadge
              tone={history.status === 'PENDING' ? 'attention' : 'neutral'}
              variant="solid"
            >
              {statusChip(history)}
            </StatusBadge>
          ) : null}
        </span>
      </Link>
    </li>
  );
}
