import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ControlCenterApi from '@/lib/control-center-api';

const { getAuditEvents } = vi.hoisted(() => ({ getAuditEvents: vi.fn() }));
vi.mock('@/lib/control-center-api', async (importOriginal) => ({
  ...(await importOriginal<typeof ControlCenterApi>()),
  getAuditEvents,
}));

import { AuditDashboard } from './audit-dashboard';

const actorId = '11111111-1111-4111-8111-111111111111';
const response = {
  data: {
    events: [
      {
        id: 7,
        actorId,
        actorName: 'Rodrigo',
        subjectId: '22222222-2222-4222-8222-222222222222',
        action: 'AI_CONFIG_PUBLISHED',
        entityType: 'agent_config',
        entityId: '33333333-3333-4333-8333-333333333333',
        createdAt: '2026-08-14T02:00:00.000Z',
      },
    ],
    actors: [{ id: actorId, name: 'Rodrigo' }],
    actions: ['AI_CONFIG_PUBLISHED'],
    pagination: { page: 1, pageSize: 25, total: 1, totalPages: 1 },
  },
  meta: {
    generatedAt: '2026-08-14T02:01:00.000Z',
    timezone: 'America/Sao_Paulo' as const,
    dataQuality: [],
  },
};

beforeEach(() => getAuditEvents.mockReset().mockResolvedValue(response));

describe('AuditDashboard', () => {
  it('lista eventos sem expor identificadores completos', async () => {
    render(<AuditDashboard />);
    expect((await screen.findAllByText('AI_CONFIG_PUBLISHED')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Rodrigo').length).toBeGreaterThan(0);
    expect(screen.queryByText('33333333-3333-4333-8333-333333333333')).toBeNull();
  });

  it('busca por ator, ação e período', async () => {
    const user = userEvent.setup();
    render(<AuditDashboard />);
    await screen.findAllByText('AI_CONFIG_PUBLISHED');
    await user.selectOptions(screen.getByLabelText('Ator'), actorId);
    await user.selectOptions(screen.getByLabelText('Tipo de ação'), 'AI_CONFIG_PUBLISHED');
    await user.type(screen.getByLabelText('De'), '2026-08-01');
    await user.type(screen.getByLabelText('Até'), '2026-08-14');
    await user.click(screen.getByRole('button', { name: 'Buscar' }));
    await waitFor(() =>
      expect(getAuditEvents).toHaveBeenLastCalledWith(
        {
          actorId,
          action: 'AI_CONFIG_PUBLISHED',
          from: '2026-08-01',
          to: '2026-08-14',
          page: 1,
          pageSize: 25,
        },
        expect.any(AbortSignal),
      ),
    );
  });
});
