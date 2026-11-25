import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { listDomains } = vi.hoisted(() => ({ listDomains: vi.fn() }));
vi.mock('@/lib/methodology-studio-api', () => ({ listDomains }));

import { MethodologyStudio } from './methodology-studio';

function domain(
  key: string,
  title: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    domain: key,
    title,
    description: `Descrição de ${title}`,
    owner: 'CREF',
    publishedVersion: 1,
    publishedAt: '2026-10-20T15:00:00.000Z',
    openDraft: null,
    ...overrides,
  };
}

beforeEach(() => {
  listDomains.mockReset().mockResolvedValue([
    domain('STRENGTH', 'Musculação e força'),
    domain('NUTRITION', 'Nutrição', {
      owner: 'CRN',
      openDraft: { id: 'd1', version: 2, status: 'DRAFT' },
    }),
    domain('HYROX', 'HYROX', {
      openDraft: { id: 'd2', version: 2, status: 'TESTING' },
    }),
    domain('RECOVERY', 'Recuperação', { publishedVersion: null, publishedAt: null }),
    domain('SAFETY', 'Segurança', { owner: 'CREF_CRN' }),
  ]);
});

describe('MethodologyStudio', () => {
  it('explica o processo e agrupa os domínios por área', async () => {
    render(<MethodologyStudio />);

    expect(screen.getByRole('heading', { level: 1, name: 'Metodologia' })).toBeVisible();
    expect(screen.getByText(/Nada muda para os alunos até você publicar/)).toBeVisible();
    const steps = within(screen.getByRole('list', { name: 'Como funciona' }));
    expect(steps.getByText('Edite')).toBeVisible();
    expect(steps.getByText('Teste')).toBeVisible();
    expect(steps.getByText('Publique')).toBeVisible();

    expect(await screen.findByRole('heading', { name: 'Modalidades de treino' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Alimentação e recuperação' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Acompanhamento e regras da IA' })).toBeVisible();
  });

  it('mostra o estado e o próximo passo de cada domínio', async () => {
    render(<MethodologyStudio />);
    await screen.findByRole('heading', { name: 'Modalidades de treino' });

    const card = (key: string) =>
      within(
        screen
          .getAllByRole('link')
          .find((link) => link.getAttribute('href')?.endsWith(`/${key}`)) as HTMLElement,
      );
    expect(card('strength').getByText('Em vigor')).toBeVisible();
    expect(card('strength').getByText('Abrir')).toBeVisible();
    expect(card('nutrition').getByText('Rascunho em edição')).toBeVisible();
    expect(card('nutrition').getByText('Continuar o rascunho')).toBeVisible();
    expect(card('nutrition').getByText('Nutrição', { selector: 'p, span' })).toBeVisible();
    expect(card('hyrox').getByText('Pronta para publicar')).toBeVisible();
    expect(card('hyrox').getByText('Publicar a nova versão')).toBeVisible();
    expect(card('recovery').getByText('Sem versão publicada')).toBeVisible();
    expect(card('recovery').getByText('Começar')).toBeVisible();
    expect(card('safety').getByText('Educação Física e Nutrição')).toBeVisible();
  });

  it('cada cartão leva ao editor do domínio e o resumo conta o que falta', async () => {
    render(<MethodologyStudio />);
    await screen.findByRole('heading', { name: 'Modalidades de treino' });

    expect(screen.getByRole('link', { name: /Musculação e força/ })).toHaveAttribute(
      'href',
      '/dashboard/ia/metodologia/strength',
    );
    expect(screen.getByText('Em vigor', { selector: 'dt' }).nextElementSibling).toHaveTextContent(
      '4 de 5',
    );
    expect(screen.getByText('Rascunhos abertos').nextElementSibling).toHaveTextContent('2');
    expect(
      screen.getByText('Sem versão publicada', { selector: 'dt' }).nextElementSibling,
    ).toHaveTextContent('1');
  });

  it('domínio fora dos grupos conhecidos aparece em "Outras"', async () => {
    listDomains.mockResolvedValue([domain('NOVO', 'Domínio novo')]);
    render(<MethodologyStudio />);

    expect(await screen.findByRole('heading', { name: 'Outras' })).toBeVisible();
    expect(screen.getByRole('link', { name: /Domínio novo/ })).toBeVisible();
  });

  it('falha ao carregar: avisa e permite tentar de novo', async () => {
    listDomains.mockReset().mockRejectedValueOnce(new Error('API fora do ar'));
    listDomains.mockResolvedValue([domain('STRENGTH', 'Musculação e força')]);
    render(<MethodologyStudio />);

    expect(await screen.findByRole('alert')).toHaveTextContent('API fora do ar');
    await userEvent.click(screen.getByRole('button', { name: /Tentar de novo/ }));

    expect(await screen.findByRole('link', { name: /Musculação e força/ })).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
