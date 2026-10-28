import { describe, expect, it, vi } from 'vitest';

import type { PublishedMethodologyReader } from '../../methodology/published-methodology.reader';
import { PublishedPolicies } from './published-policies';

function policiesWith(published: unknown) {
  const reader = { publishedOf: vi.fn(async () => published) };
  return new PublishedPolicies(reader as unknown as PublishedMethodologyReader);
}

describe('PublishedPolicies', () => {
  it('sem documento publicado devolve null e o motor usa os padrões conservadores', async () => {
    const policies = policiesWith(null);
    expect(await policies.autonomy()).toBeNull();
    expect(await policies.sentinel()).toBeNull();
  });

  it('lê a política de autonomia do documento publicado, com versão e id', async () => {
    const policies = policiesWith({
      id: 'doc-9',
      version: 3,
      parameters: { actions: { highUncertainty: 'ESCALATE' } },
    });
    expect(await policies.autonomy()).toMatchObject({
      version: 3,
      documentId: 'doc-9',
      highUncertainty: 'ESCALATE',
    });
  });

  it('lê os parâmetros da sentinela do documento SAFETY publicado', async () => {
    const policies = policiesWith({ id: 'doc-1', version: 1, parameters: {} });
    expect(await policies.sentinel()).not.toBeNull();
  });
});
