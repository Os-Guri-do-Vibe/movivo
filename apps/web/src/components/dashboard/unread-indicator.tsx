/**
 * Marca de "não lido" que não depende só de cor: ponto neutro (contraste nos dois temas) mais
 * um texto para leitor de tela. Quem usa também reforça o título em negrito.
 */
export function UnreadIndicator({ read, label = 'Não lida. ' }: { read: boolean; label?: string }) {
  if (read) return null;
  return (
    <>
      <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-foreground" />
      <span className="sr-only">{label}</span>
    </>
  );
}
