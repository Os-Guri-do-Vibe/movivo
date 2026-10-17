import { BadRequestException } from '@nestjs/common';

/**
 * Extração de texto dos artigos científicos enviados à Base de Conhecimento.
 *
 * O que entra no RAG é só texto: o arquivo original fica guardado, mas nada dele é executado
 * ou renderizado. Formatos aceitos: PDF, Word (.docx), planilha (.xlsx/.csv), Markdown e TXT.
 *
 * Defesas deste módulo (o parser roda no worker, fora do request):
 *  - extensão, MIME e assinatura binária (magic bytes) precisam concordar;
 *  - OOXML (docx/xlsx) é um zip: o diretório central é lido ANTES de descompactar para barrar
 *    zip bomb (soma dos tamanhos descompactados, número de entradas e razão de compressão);
 *  - PDF tem teto de páginas; o texto extraído tem teto de caracteres.
 */

export type ArticleFormat = 'pdf' | 'docx' | 'xlsx' | 'csv' | 'txt' | 'md';

interface ArticleFormatSpec {
  format: ArticleFormat;
  mimeType: string;
  label: string;
}

/** Extensão → formato aceito. É a única fonte da allowlist de upload. */
export const ARTICLE_FORMATS: ReadonlyMap<string, ArticleFormatSpec> = new Map([
  ['.pdf', { format: 'pdf', mimeType: 'application/pdf', label: 'PDF' }],
  [
    '.docx',
    {
      format: 'docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      label: 'Word',
    },
  ],
  [
    '.xlsx',
    {
      format: 'xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      label: 'Planilha',
    },
  ],
  ['.csv', { format: 'csv', mimeType: 'text/csv', label: 'CSV' }],
  ['.txt', { format: 'txt', mimeType: 'text/plain', label: 'TXT' }],
  ['.md', { format: 'md', mimeType: 'text/markdown', label: 'Markdown' }],
]);

export const ARTICLE_MIME_TYPES: readonly string[] = [
  ...new Set([...ARTICLE_FORMATS.values()].map((spec) => spec.mimeType)),
];

/** Navegadores e SOs informam MIME divergente para o mesmo arquivo; aceitamos os sinônimos reais. */
const MIME_ALIASES: Record<string, readonly string[]> = {
  'text/csv': ['application/csv', 'application/vnd.ms-excel', 'text/plain'],
  'text/markdown': ['text/x-markdown', 'text/plain'],
  'text/plain': [],
};

export const MAX_EXTRACTED_CHARS = 1_500_000;
const MAX_PDF_PAGES = 400;
const MAX_ZIP_ENTRIES = 2_000;
const MAX_ZIP_UNCOMPRESSED_BYTES = 150 * 1024 * 1024;
const MAX_ZIP_RATIO = 200;
const MAX_SHEET_ROWS = 20_000;

function reject(code: string, message: string): never {
  throw new BadRequestException({ code, message });
}

export function extensionOf(filename: string): string {
  const offset = filename.lastIndexOf('.');
  return offset < 0 ? '' : filename.slice(offset).toLowerCase();
}

export function articleFormatOf(filename: string): ArticleFormatSpec | null {
  return ARTICLE_FORMATS.get(extensionOf(filename)) ?? null;
}

/** O MIME informado pelo navegador precisa ser o do formato ou um sinônimo conhecido. */
export function mimeMatchesFormat(spec: ArticleFormatSpec, mimeType: string): boolean {
  const informed = mimeType.toLowerCase().split(';')[0]?.trim() ?? '';
  if (informed === spec.mimeType) return true;
  if (MIME_ALIASES[spec.mimeType]?.includes(informed)) return true;
  // Alguns SOs não conhecem a extensão e mandam o tipo genérico; a assinatura decide.
  return informed === 'application/octet-stream' || informed === '';
}

const PDF_MAGIC = Buffer.from('%PDF-');
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

export function hasValidSignature(buffer: Buffer, format: ArticleFormat): boolean {
  if (format === 'pdf') {
    // A especificação tolera lixo nos primeiros 1024 bytes antes do cabeçalho.
    return buffer.subarray(0, 1024).includes(PDF_MAGIC);
  }
  if (format === 'docx' || format === 'xlsx') return buffer.subarray(0, 4).equals(ZIP_MAGIC);
  return !buffer.subarray(0, 8192).includes(0);
}

/** Lê o diretório central do zip (sem descompactar nada) e recusa arquivos suspeitos. */
export function assertSafeZip(buffer: Buffer): void {
  const minimum = 22;
  let eocd = -1;
  for (
    let at = buffer.length - minimum;
    at >= Math.max(0, buffer.length - minimum - 65_535);
    at--
  ) {
    if (buffer.readUInt32LE(at) === 0x06054b50) {
      eocd = at;
      break;
    }
  }
  if (eocd < 0)
    reject('INVALID_ARCHIVE', 'O arquivo está corrompido ou não é um documento válido.');
  const entries = buffer.readUInt16LE(eocd + 10);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  if (entries > MAX_ZIP_ENTRIES) reject('ARCHIVE_TOO_COMPLEX', 'O documento tem partes demais.');
  if (centralOffset + centralSize > buffer.length) {
    reject('INVALID_ARCHIVE', 'O arquivo está corrompido ou não é um documento válido.');
  }

  let cursor = centralOffset;
  let uncompressed = 0;
  let compressed = 0;
  for (let index = 0; index < entries; index++) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== 0x02014b50) {
      reject('INVALID_ARCHIVE', 'O arquivo está corrompido ou não é um documento válido.');
    }
    compressed += buffer.readUInt32LE(cursor + 20);
    uncompressed += buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  if (
    uncompressed > MAX_ZIP_UNCOMPRESSED_BYTES ||
    (compressed > 0 && uncompressed / compressed > MAX_ZIP_RATIO && uncompressed > 5_000_000)
  ) {
    reject('ARCHIVE_TOO_LARGE', 'O documento descompactado é grande demais para ser processado.');
  }
}

/**
 * Limpa o que sobra de extração: controles, hifenização de fim de linha (comum em PDF),
 * espaços repetidos. Mantém parágrafos (linha em branco) e tabulação.
 */
export function normalizeExtractedText(raw: string): string {
  return (
    raw
      .normalize('NFC')
      .replace(/\r\n?/g, '\n')
      .replace(/\f/g, '\n\n')
      .replace(/\u00ad/g, '')
      .replace(/\u00a0/g, ' ')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b\u000e-\u001f\u007f�]/g, '')
      .replace(/([A-Za-zÀ-ÿ])-\n(?=[a-zà-ÿ])/g, '$1')
      .replace(/[ \t]+/g, ' ')
      .replace(/ ?\n ?/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

function plainText(buffer: Buffer): string {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
  // BOM de arquivos salvos pelo Windows/Excel.
  return text.replace(/^\ufeff/, '');
}

async function pdfText(buffer: Buffer): Promise<string> {
  const { extractText, getDocumentProxy } = await import('unpdf');
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    pdf = await getDocumentProxy(new Uint8Array(buffer));
  } catch {
    reject('INVALID_PDF', 'Não foi possível abrir o PDF. Ele pode estar corrompido ou protegido.');
  }
  if (pdf.numPages > MAX_PDF_PAGES) {
    reject('PDF_TOO_LONG', `O PDF tem mais de ${MAX_PDF_PAGES} páginas.`);
  }
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

async function docxText(buffer: Buffer): Promise<string> {
  assertSafeZip(buffer);
  const mammoth = await import('mammoth');
  try {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  } catch {
    reject('INVALID_DOCX', 'Não foi possível ler o arquivo Word. Ele pode estar corrompido.');
  }
}

async function xlsxText(buffer: Buffer): Promise<string> {
  assertSafeZip(buffer);
  const { default: readExcelFile } = await import('read-excel-file/node');
  let sheets: Array<{ sheet: string; data: unknown[][] }>;
  try {
    sheets = (await readExcelFile(buffer)) as Array<{ sheet: string; data: unknown[][] }>;
  } catch {
    reject('INVALID_XLSX', 'Não foi possível ler a planilha. Ela pode estar corrompida.');
  }
  const out: string[] = [];
  let rows = 0;
  for (const sheet of sheets) {
    out.push(`# ${sheet.sheet}`);
    for (const row of sheet.data) {
      rows++;
      if (rows > MAX_SHEET_ROWS) {
        reject('SHEET_TOO_LARGE', `A planilha tem mais de ${MAX_SHEET_ROWS} linhas.`);
      }
      const cells = row.map((cell) => {
        if (cell === null || cell === undefined) return '';
        if (cell instanceof Date) return cell.toISOString().slice(0, 10);
        return String(cell);
      });
      if (cells.some((cell) => cell !== '')) out.push(cells.join(' | '));
    }
    out.push('');
  }
  return out.join('\n');
}

export async function extractArticleText(buffer: Buffer, format: ArticleFormat): Promise<string> {
  let raw: string;
  switch (format) {
    case 'pdf':
      raw = await pdfText(buffer);
      break;
    case 'docx':
      raw = await docxText(buffer);
      break;
    case 'xlsx':
      raw = await xlsxText(buffer);
      break;
    case 'csv':
    case 'txt':
    case 'md':
      raw = plainText(buffer);
      break;
  }
  const text = normalizeExtractedText(raw);
  if (text.length === 0 && format === 'pdf') {
    reject(
      'NO_TEXT_LAYER',
      'O PDF não tem texto selecionável (parece escaneado). Envie uma versão com texto.',
    );
  }
  if (text.length > MAX_EXTRACTED_CHARS) {
    reject('TEXT_TOO_LONG', 'O artigo é extenso demais para ser indexado.');
  }
  return text;
}
