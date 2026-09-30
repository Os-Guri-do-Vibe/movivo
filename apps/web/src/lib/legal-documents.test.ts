import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseApprovedLegalDocument } from './legal-documents';

const approved = `<!-- MOVIVO_LEGAL_METADATA_START
publication_status: APPROVED
document_version: terms-2026-09-v1
drafted_on: 2026-09-29
effective_on: 2026-10-01
MOVIVO_LEGAL_METADATA_END -->
# Termos de Uso

Texto público.`;

describe('gate de publicação dos documentos legais', () => {
  it('publica apenas versão explicitamente liberada e aprovada com vigência', () => {
    expect(parseApprovedLegalDocument(approved, null)).toBeNull();
    expect(parseApprovedLegalDocument(approved, 'terms-2026-08-v2')).toBeNull();
    expect(parseApprovedLegalDocument(approved, 'terms-2026-09-v1')).toEqual({
      version: 'terms-2026-09-v1',
      effectiveOn: '2026-10-01',
      markdown: '# Termos de Uso\n\nTexto público.',
    });
  });

  it('não publica minuta ou documento sem data de vigência', () => {
    expect(
      parseApprovedLegalDocument(
        approved.replace('publication_status: APPROVED', 'publication_status: DRAFT_BLOCKED'),
        'terms-2026-09-v1',
      ),
    ).toBeNull();
    expect(
      parseApprovedLegalDocument(
        approved.replace('effective_on: 2026-10-01', 'effective_on: PENDING'),
        'terms-2026-09-v1',
      ),
    ).toBeNull();
  });

  it.each([
    ['termos-de-uso.md', 'terms-2026-09-v1'],
    ['politica-de-privacidade.md', 'privacy-2026-09-v1'],
  ])('rejeita a minuta real %s mesmo com status trocado por engano', (file, version) => {
    const source = readFileSync(resolve(process.cwd(), '../../docs/juridico', file), 'utf8');
    expect(parseApprovedLegalDocument(source, version)).toBeNull();
    expect(
      parseApprovedLegalDocument(
        source
          .replace('publication_status: DRAFT_BLOCKED', 'publication_status: APPROVED')
          .replace('effective_on: PENDING', 'effective_on: 2026-10-01'),
        version,
      ),
    ).toBeNull();
  });
});
