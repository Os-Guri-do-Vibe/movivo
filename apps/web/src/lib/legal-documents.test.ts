import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { LEGAL_RELEASE, legalReleaseMatchesConsent } from './legal-release';
import { parseLegalDocument } from './legal-documents';

const approved = `<!-- MOVIVO_LEGAL_METADATA_START
publication_status: APPROVED
document_version: terms-2026-09-v1
drafted_on: 2026-09-29
effective_on: 2026-10-01
MOVIVO_LEGAL_METADATA_END -->
# Termos de Uso

Texto público.`;

describe('visibilidade dos documentos legais', () => {
  it('usa no aceite a mesma versão dos Termos exibidos', () => {
    expect(legalReleaseMatchesConsent).toBe(true);
  });

  it('publica versão aprovada apenas com vigência e versão liberada', () => {
    expect(parseLegalDocument(approved, null)).toBeNull();
    expect(parseLegalDocument(approved, 'terms-2026-08-v2')).toBeNull();
    expect(parseLegalDocument(approved, 'terms-2026-09-v1')).toEqual({
      version: 'terms-2026-09-v1',
      status: 'APPROVED',
      effectiveOn: '2026-10-01',
      markdown: '# Termos de Uso\n\nTexto público.',
    });
  });

  it('não publica minuta bloqueada nem documento aprovado sem vigência', () => {
    expect(
      parseLegalDocument(
        approved.replace('publication_status: APPROVED', 'publication_status: DRAFT_BLOCKED'),
        'terms-2026-09-v1',
      ),
    ).toBeNull();
    expect(
      parseLegalDocument(
        approved.replace('effective_on: 2026-10-01', 'effective_on: PENDING'),
        'terms-2026-09-v1',
      ),
    ).toBeNull();
  });

  it.each([
    ['termos-de-uso.md', LEGAL_RELEASE.terms],
    ['politica-de-privacidade.md', LEGAL_RELEASE.privacy],
  ])('exibe a versão beta real %s com campos pendentes identificados', (file, version) => {
    const source = readFileSync(resolve(process.cwd(), '../../docs/juridico', file), 'utf8');
    const document = parseLegalDocument(source, version);
    expect(document).toMatchObject({ version, status: 'BETA_VISIBLE', effectiveOn: null });
    expect(document?.markdown).toContain('[CNPJ]');
    expect(
      parseLegalDocument(
        source
          .replace('publication_status: BETA_VISIBLE', 'publication_status: APPROVED')
          .replace('effective_on: PENDING', 'effective_on: 2026-10-01'),
        version,
      ),
    ).toBeNull();
  });
});
