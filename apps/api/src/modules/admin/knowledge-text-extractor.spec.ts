import { join } from 'node:path';

import { BadRequestException } from '@nestjs/common';
import JSZip from 'jszip';
import pdfMake from 'pdfmake';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  ARTICLE_FORMATS,
  articleFormatOf,
  assertSafeZip,
  extractArticleText,
  hasValidSignature,
  mimeMatchesFormat,
  normalizeExtractedText,
} from './knowledge-text-extractor';

const FONTS_DIR = join(__dirname, '../../../assets/fonts');
const TEXT =
  'O volume semanal de séries por grupo muscular modula a hipertrofia em adultos treinados.';

beforeAll(() => {
  pdfMake.setFonts({
    Hanken: {
      normal: join(FONTS_DIR, 'HankenGrotesk-Regular.ttf'),
      bold: join(FONTS_DIR, 'HankenGrotesk-Bold.ttf'),
      italics: join(FONTS_DIR, 'HankenGrotesk-Regular.ttf'),
      bolditalics: join(FONTS_DIR, 'HankenGrotesk-Bold.ttf'),
    },
  });
  pdfMake.setLocalAccessPolicy((path) => path.startsWith(FONTS_DIR));
  pdfMake.setUrlAccessPolicy(() => false);
});

async function pdfBuffer(pages: string[]): Promise<Buffer> {
  const content = pages.flatMap((text, index) => [
    { text, pageBreak: index > 0 ? ('before' as const) : undefined },
  ]);
  return Buffer.from(
    await pdfMake.createPdf({ content, defaultStyle: { font: 'Hanken' } }).getBuffer(),
  );
}

async function docxBuffer(paragraphs: string[]): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  const body = paragraphs.map((text) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`).join('');
  zip.file(
    'word/document.xml',
    `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

async function xlsxBuffer(rows: string[][]): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
  );
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
  );
  zip.file(
    'xl/workbook.xml',
    '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Estudos" sheetId="1" r:id="rId1"/></sheets></workbook>',
  );
  zip.file(
    'xl/_rels/workbook.xml.rels',
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
  );
  const sheetRows = rows
    .map(
      (row, r) =>
        `<row r="${r + 1}">${row
          .map(
            (cell, c) =>
              `<c r="${String.fromCharCode(65 + c)}${r + 1}" t="inlineStr"><is><t>${cell}</t></is></c>`,
          )
          .join('')}</row>`,
    )
    .join('');
  zip.file(
    'xl/worksheets/sheet1.xml',
    `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`,
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('formatos aceitos', () => {
  it('aceita PDF, Word, planilha, CSV, TXT e Markdown — e nenhuma imagem', () => {
    expect([...ARTICLE_FORMATS.keys()].sort()).toEqual(
      ['.csv', '.docx', '.md', '.pdf', '.txt', '.xlsx'].sort(),
    );
    expect(articleFormatOf('foto.png')).toBeNull();
    expect(articleFormatOf('ARTIGO.PDF')?.format).toBe('pdf');
  });

  it('confere o MIME informado com o formato (e aceita sinônimos reais)', () => {
    const pdf = articleFormatOf('a.pdf');
    const csv = articleFormatOf('a.csv');
    if (!pdf || !csv) throw new Error('formato ausente');
    expect(mimeMatchesFormat(pdf, 'application/pdf')).toBe(true);
    expect(mimeMatchesFormat(pdf, 'image/png')).toBe(false);
    expect(mimeMatchesFormat(csv, 'application/vnd.ms-excel')).toBe(true);
    expect(mimeMatchesFormat(pdf, 'application/octet-stream')).toBe(true);
  });

  it('valida a assinatura binária de cada formato', () => {
    expect(hasValidSignature(Buffer.from('%PDF-1.4 x'), 'pdf')).toBe(true);
    expect(hasValidSignature(Buffer.from('texto'), 'pdf')).toBe(false);
    expect(hasValidSignature(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0]), 'docx')).toBe(true);
    expect(hasValidSignature(Buffer.from('texto'), 'xlsx')).toBe(false);
    expect(hasValidSignature(Buffer.from('a,b\n1,2'), 'csv')).toBe(true);
    expect(hasValidSignature(Buffer.from([0x4d, 0x5a, 0, 0]), 'txt')).toBe(false);
  });
});

describe('extractArticleText', () => {
  it('extrai o texto de um PDF com várias páginas', async () => {
    const text = await extractArticleText(
      await pdfBuffer([TEXT, 'Segunda página do artigo.']),
      'pdf',
    );
    expect(text).toContain('hipertrofia');
    expect(text).toContain('Segunda página');
  });

  it('PDF corrompido falha com código claro', async () => {
    await expect(extractArticleText(Buffer.from('%PDF-1.4 lixo'), 'pdf')).rejects.toMatchObject({
      response: { code: 'INVALID_PDF' },
    });
  });

  it('PDF sem camada de texto (escaneado) é recusado com mensagem acionável', async () => {
    const empty = Buffer.from(
      await pdfMake
        .createPdf({ content: [{ text: ' ' }], defaultStyle: { font: 'Hanken' } })
        .getBuffer(),
    );
    await expect(extractArticleText(empty, 'pdf')).rejects.toMatchObject({
      response: { code: 'NO_TEXT_LAYER' },
    });
  });

  it('extrai o texto de um documento Word', async () => {
    const text = await extractArticleText(await docxBuffer([TEXT, 'Conclusão do estudo.']), 'docx');
    expect(text).toContain('hipertrofia');
    expect(text).toContain('Conclusão do estudo.');
  });

  it('transforma a planilha em linhas legíveis, com o nome da aba', async () => {
    const text = await extractArticleText(
      await xlsxBuffer([
        ['Estudo', 'Volume'],
        ['Schoenfeld 2017', '10 séries'],
      ]),
      'xlsx',
    );
    expect(text).toContain('# Estudos');
    expect(text).toContain('Schoenfeld 2017 | 10 séries');
  });

  it('lê TXT, Markdown e CSV como texto (removendo o BOM)', async () => {
    expect(await extractArticleText(Buffer.from('﻿# Título\n\nCorpo.'), 'md')).toBe(
      '# Título\n\nCorpo.',
    );
    expect(await extractArticleText(Buffer.from('a,b\n1,2'), 'csv')).toBe('a,b\n1,2');
  });

  it('recusa arquivo Word que não é um zip válido', async () => {
    await expect(
      extractArticleText(Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]), 'docx'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('assertSafeZip (zip bomb)', () => {
  it('aceita um documento normal', async () => {
    const docx = await docxBuffer([TEXT]);
    expect(() => assertSafeZip(docx)).not.toThrow();
  });

  it('recusa quem não é zip', () => {
    expect(() => assertSafeZip(Buffer.from('isto não é um zip de verdade, só texto'))).toThrow(
      BadRequestException,
    );
  });

  it('recusa arquivo que descompacta com razão absurda (zip bomb)', async () => {
    const zip = new JSZip();
    zip.file('word/document.xml', Buffer.alloc(8 * 1024 * 1024), { compression: 'DEFLATE' });
    const bomb = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    expect(bomb.byteLength).toBeLessThan(1024 * 1024);
    expect(() => assertSafeZip(bomb)).toThrow(BadRequestException);
    await expect(extractArticleText(bomb, 'docx')).rejects.toMatchObject(
      {
        response: { code: 'ARCHIVE_TOO_LARGE' },
      },
      30_000,
    );
  });

  it('recusa zip com entradas demais', async () => {
    const zip = new JSZip();
    for (let index = 0; index < 2_001; index++) zip.file(`parte-${index}.xml`, 'x');
    const many = await zip.generateAsync({ type: 'nodebuffer' });
    expect(() => assertSafeZip(many)).toThrow(BadRequestException);
  });
});

describe('normalizeExtractedText', () => {
  it('une palavras hifenizadas no fim da linha e remove controles', () => {
    expect(normalizeExtractedText('exer-\ncício   físico\u0000\f\n\n\n\nfim')).toBe(
      'exercício físico\n\nfim',
    );
  });
});
