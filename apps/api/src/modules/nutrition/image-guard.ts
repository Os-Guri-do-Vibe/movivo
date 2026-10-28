import { BadRequestException } from '@nestjs/common';

export type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/webp';

/** Tipo pela ASSINATURA do arquivo (nunca pelo nome nem pelo `Content-Type` enviado). */
export function sniffImage(bytes: Uint8Array): ImageMediaType | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  const riff = String.fromCharCode(...bytes.slice(0, 4));
  const webp = String.fromCharCode(...bytes.slice(8, 12));
  if (riff === 'RIFF' && webp === 'WEBP') return 'image/webp';
  return null;
}

/** Valida e devolve a imagem em base64 para a visão. */
export function imageForVision(file: { buffer: Buffer } | undefined): {
  mediaType: ImageMediaType;
  base64: string;
} {
  if (!file) throw new BadRequestException('Envie a imagem no campo "file".');
  const mediaType = sniffImage(file.buffer);
  if (!mediaType) throw new BadRequestException('Envie uma imagem JPEG, PNG ou WebP.');
  return { mediaType, base64: file.buffer.toString('base64') };
}
