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
  status: 'APPROVED' | 'BETA_VISIBLE';
  effectiveOn: string | null;
  markdown: string;
}

export function parseLegalDocument(
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
  if (metadata.document_version !== releasedVersion) return null;
  const status = metadata.publication_status;
  if (status !== 'APPROVED' && status !== 'BETA_VISIBLE') return null;
  const effectiveOn = metadata.effective_on ?? '';
  if (status === 'APPROVED' && !/^\d{4}-\d{2}-\d{2}$/.test(effectiveOn)) return null;
  if (status === 'BETA_VISIBLE' && effectiveOn !== 'PENDING') return null;

  const markdown = source.slice(match[0].length).trim();
  // Texto aprovado não pode conter campos pendentes; a versão beta os identifica na página.
  if (!markdown || (status === 'APPROVED' && /\[[A-ZÀ-Ú][^\]\n]*\](?!\()/.test(markdown))) {
    return null;
  }

  return {
    version: releasedVersion,
    status,
    effectiveOn: status === 'APPROVED' ? effectiveOn : null,
    markdown,
  };
}

export function loadLegalDocument(kind: LegalDocumentKind): LegalDocument | null {
  if (!legalReleaseMatchesConsent) return null;
  const releasedVersion = LEGAL_RELEASE[kind];

  const root = process.cwd().endsWith('apps/web') ? '../..' : '.';
  const file = resolve(process.cwd(), root, 'docs/juridico', FILES[kind]);
  return parseLegalDocument(readFileSync(file, 'utf8'), releasedVersion);
}
