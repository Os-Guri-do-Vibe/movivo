/** "Há 5 min", "Há 3 h", "Há 2 dias": idade de um alerta/notificação para listas e cartões. */
export function elapsed(createdAt: string): string {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 60_000));
  if (minutes < 1) return 'Agora';
  if (minutes < 60) return `Há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Há ${hours} h`;
  return `Há ${Math.floor(hours / 24)} dia${hours >= 48 ? 's' : ''}`;
}
