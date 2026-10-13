import { describe, expect, it } from 'vitest';

import { alertCopyFor, alertSourceLabel } from './alert-copy';

describe('alertCopyFor', () => {
  it('traduz os motivos técnicos para a intervenção compreensível pelo CREF', () => {
    expect(alertCopyFor({ level: 'ALERT', reason: 'FORA_DE_ESCOPO' })).toMatchObject({
      title: 'Assunto fora do escopo do AI Coach',
    });
    expect(alertSourceLabel('PROTOCOL_RENEWAL')).toBe('Renovação de protocolo');
  });
});
