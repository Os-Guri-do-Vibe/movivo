import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { LEGAL_RELEASE, legalReleaseMatchesConsent } from './legal-release';

export type LegalDocumentKind = 'terms' | 'privacy';

const FILES: Record<LegalDocumentKind, string> = {
  terms: 'termos-de-uso.md',
  privacy: 'politica-de-privacidade.md',
};

export interface LegalDocument {
  version: string;
  effectiveOn: string;
  markdown: string;
}

export function parseApprovedLegalDocument(
  source: string,
  releasedVersion: string | null,
): LegalDocument | null {
  if (!releasedVersion) return null;

  const match =
    /^<!-- MOVIVO_LEGAL_METADATA_START\r?\n([\s\S]*?)\r?\nMOVIVO_LEGAL_METADATA_END -->\r?\n/.exec(
      source,
    );
  if (!match) return null;
  const metadataBlock = match[1];
  if (!metadataBlock) return null;

  const metadata = Object.fromEntries(
    metadataBlock
      .split(/\r?\n/)
      .map((line) => line.match(/^([a-z_]+): (.+)$/))
      .filter((entry): entry is RegExpMatchArray => entry !== null)
      .map((entry) => [entry[1], entry[2]]),
  );
  if (
    metadata.publication_status !== 'APPROVED' ||
    metadata.document_version !== releasedVersion ||
    !/^\d{4}-\d{2}-\d{2}$/.test(metadata.effective_on ?? '')
  ) {
    return null;
  }

  const markdown = source.slice(match[0].length).trim();
  // Placeholders editoriais como [CNPJ] e [E-MAIL DO ENCARREGADO] nunca vão ao público.
  if (!markdown || /\[[A-ZÀ-Ú][^\]\n]*\](?!\()/.test(markdown)) return null;

  return {
    version: releasedVersion,
    effectiveOn: metadata.effective_on,
    markdown,
  };
}

export function loadLegalDocument(kind: LegalDocumentKind): LegalDocument | null {
  if (!legalReleaseMatchesConsent) return null;
  const releasedVersion = LEGAL_RELEASE[kind];

  const root = process.cwd().endsWith('apps/web') ? '../..' : '.';
  const file = resolve(process.cwd(), root, 'docs/juridico', FILES[kind]);
  return parseApprovedLegalDocument(readFileSync(file, 'utf8'), releasedVersion);
}
