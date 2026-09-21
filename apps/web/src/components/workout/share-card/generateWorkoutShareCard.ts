export function formatShareCardDuration(durationMinutes: number): string {
  if (!Number.isFinite(durationMinutes) || durationMinutes < 0) return '—';
  if (durationMinutes > 0 && durationMinutes < 1) return '<1min';
  const minutes = Math.round(durationMinutes);
  if (minutes < 60) return `${minutes}min`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}min`;
}

/** Aguarda fontes, imagens HTML e os rasters dentro dos SVGs da biblioteca. */
export async function generateWorkoutShareCard(node: HTMLElement): Promise<Blob> {
  const { toBlob } = await import('html-to-image');
  await document.fonts.ready;
  const sources = [
    ...Array.from(node.querySelectorAll('img'), (img) => img.currentSrc || img.src),
    ...Array.from(node.querySelectorAll('svg image'), (img) => img.getAttribute('href') ?? ''),
  ];
  if (node.querySelectorAll('svg image').length !== 2) {
    throw new Error('O desenho do treino ainda não carregou. Tente novamente.');
  }
  await Promise.all(
    sources.map(async (src) => {
      const img = new window.Image();
      img.src = src;
      await img.decode();
    }),
  );
  // DPR fixo: Retina não pode transformar o arquivo de 1080×1920 em 3240×5760.
  // Não usamos cacheBust: todos os recursos são locais e não contêm dados do aluno.
  const blob = await toBlob(node, {
    width: 1080,
    height: 1920,
    canvasWidth: 1080,
    canvasHeight: 1920,
    pixelRatio: 1,
    // Fonte de sistema no card: evita @font-face/data: bloqueados pela CSP no SVG
    // serializado e mantém as mesmas métricas de texto na prévia e no PNG.
    skipFonts: true,
    // Sem preenchimento do canvas: preserva o canal alfa para sobrepor a uma foto.
  });
  if (!blob || blob.size === 0)
    throw new Error('Não foi possível criar a imagem. Tente novamente.');
  return blob;
}
