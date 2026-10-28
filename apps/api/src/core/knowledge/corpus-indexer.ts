const CHUNK_CHARS = 1800;
const OVERLAP_CHARS = 270;

export function chunkText(text: string, size = CHUNK_CHARS, overlap = OVERLAP_CHARS): string[] {
  const clean = text.trim();
  if (clean.length <= size) return [clean];
  const chunks: string[] = [];
  const step = size - overlap;
  for (let start = 0; start < clean.length; start += step) {
    chunks.push(clean.slice(start, start + size));
    if (start + size >= clean.length) break;
  }
  return chunks;
}
