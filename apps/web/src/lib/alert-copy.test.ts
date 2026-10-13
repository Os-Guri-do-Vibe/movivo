import { describe, expect, it } from 'vitest';

import { alertCopyFor, alertSourceLabel } from './alert-copy';

describe('alertCopyFor', () => {
  it('traduz os motivos técnicos para a intervenção compreensível pelo CREF', () => {
    expect(
      alertCopyFor({
        id: 'alert-1',
        studentName: 'Ana',
        level: 'ALERT',
        reason: 'FORA_DE_ESCOPO',
        sourceType: 'CONVERSATION',
        status: 'OPEN',
        createdAt: '2026-10-12T14:30:00.000Z',
        updatedAt: '2026-10-12T14:30:00.000Z',
      }),
    ).toMatchObject({
      title: 'Assunto fora do escopo do AI Coach',
    });
    expect(alertSourceLabel('PROTOCOL_RENEWAL')).toBe('Renovação de protocolo');
  });
});
