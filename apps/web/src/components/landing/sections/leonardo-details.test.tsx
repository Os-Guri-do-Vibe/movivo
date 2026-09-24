/**
 * Formação e trajetória do Responsável Técnico: o drawer mostra a formação com a situação
 * de cada curso e nunca o apresenta como médico ou nutricionista (sem CRM/CRN).
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { RESPONSIBLE_PROFESSIONAL } from '@/lib/landing/site';

import { LeonardoDetails } from './leonardo-details';

async function openDrawer() {
  render(
    <div data-landing-root="">
      <LeonardoDetails />
    </div>,
  );
  await userEvent.click(screen.getByRole('button', { name: /Formação e trajetória/ }));
  return screen.getByRole('dialog', { name: RESPONSIBLE_PROFESSIONAL.fullName });
}

describe('LeonardoDetails', () => {
  it('abre com nome completo, posição e respaldo CREF', async () => {
    const drawer = await openDrawer();
    expect(drawer).toHaveTextContent('Sócio e responsável técnico');
    expect(drawer).toHaveTextContent('Profissional de Educação Física · Regulamentado pelo CREF');
  });

  it('formação em andamento aparece como em andamento, nunca como título', async () => {
    const drawer = await openDrawer();
    const education = within(drawer).getByRole('heading', { name: 'Formação acadêmica' })
      .nextElementSibling as HTMLElement;
    const medicine = within(education).getByText('Medicina').closest('li');
    const nutrition = within(education).getByText('Nutrição').closest('li');
    expect(medicine).toHaveTextContent('Graduação em andamento');
    expect(nutrition).toHaveTextContent('Graduação em andamento');
  });

  it('guardrails: sem credencial que ele não tem nem linguagem clínica', async () => {
    const drawer = await openDrawer();
    const text = drawer.textContent ?? '';
    expect(text).not.toMatch(/\bm[ée]dico\b|nutricionista|diagn[óo]stico|tratamento|\bcura\b/i);
  });
});
