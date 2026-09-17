import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { WeeklyCheckinForm } from './weekly-checkin-form';

function renderForm(onSubmit = vi.fn()) {
  render(<WeeklyCheckinForm onSubmit={onSubmit} saving={false} />);
  return { onSubmit };
}

async function answerRequiredQuestions(user: ReturnType<typeof userEvent.setup>) {
  // Pergunta 1 — sono.
  await user.click(screen.getByRole('radio', { name: /Boa: cerca de 7 horas/ }));
  await user.click(screen.getByRole('button', { name: 'Continuar' }));
  // Pergunta 2 — humor.
  await user.click(screen.getByRole('radio', { name: 'Feliz' }));
  await user.click(screen.getByRole('button', { name: 'Continuar' }));
  // Pergunta 3 — alimentação (slider, tem default, Continuar já habilitado).
  await user.click(screen.getByRole('button', { name: 'Continuar' }));
  // Pergunta 4 — aderência (slider, default).
  await user.click(screen.getByRole('button', { name: 'Continuar' }));
  // Pergunta 5 — exercício difícil (texto livre opcional).
  await user.click(screen.getByRole('button', { name: 'Continuar' }));
  // Pergunta 6 — mudanças percebidas (multi-select opcional).
  await user.click(screen.getByRole('button', { name: 'Continuar' }));
  // Pergunta 7 — duração do treino.
  await user.click(screen.getByRole('radio', { name: 'Sim, está adequada' }));
  await user.click(screen.getByRole('button', { name: 'Continuar' }));
}

describe('WeeklyCheckinForm — pergunta 1 (sono, obrigatório)', () => {
  it('sem seleção, Continuar fica desabilitado', () => {
    renderForm();
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled();
  });

  it('selecionar uma opção habilita Continuar e avança pra pergunta de humor', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole('radio', { name: /Ótima: 8 horas ou mais/ }));
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(
      screen.getByText('Como você descreveria o seu humor durante esta última semana?'),
    ).toBeInTheDocument();
  });
});

describe('WeeklyCheckinForm — pergunta 6 (mudanças percebidas, "Outras" condicional)', () => {
  it('exige o texto de "Outras" quando essa opção é marcada', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole('radio', { name: /Boa: cerca de 7 horas/ }));
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await user.click(screen.getByRole('radio', { name: 'Feliz' }));
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await user.click(screen.getByRole('button', { name: 'Continuar' })); // alimentação
    await user.click(screen.getByRole('button', { name: 'Continuar' })); // aderência
    await user.click(screen.getByRole('button', { name: 'Continuar' })); // exercício difícil

    await user.click(screen.getByRole('button', { name: 'Outras' }));
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled();

    await user.type(
      screen.getByLabelText('Conte para a gente quais mudanças você percebeu'),
      'Mais disposição no dia a dia',
    );
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeEnabled();
  });
});

describe('WeeklyCheckinForm — envio', () => {
  it('percorre as 8 perguntas e envia o payload completo no final', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderForm();

    await answerRequiredQuestions(user);
    // Pergunta 8 — feedback aberto (opcional), botão final é "Enviar".
    expect(screen.getByText(/aspecto do seu acompanhamento/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Enviar' }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        sleepQuality: 'BOA',
        mood: 'FELIZ',
        nutritionScore: 5,
        adherenceScore: 5,
        durationFit: 'ADEQUADA',
        changesNoticed: [],
      }),
    );
  });

  it('inclui o texto livre de exercício difícil quando preenchido', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderForm();

    await user.click(screen.getByRole('radio', { name: /Boa: cerca de 7 horas/ }));
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await user.click(screen.getByRole('radio', { name: 'Feliz' }));
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await user.type(
      screen.getByLabelText('Se sim, conte para a gente qual exercício e o motivo'),
      'Agachamento búlgaro, senti insegurança.',
    );
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await user.click(screen.getByRole('radio', { name: 'Poderiam ser um pouco mais curtos' }));
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await user.click(screen.getByRole('button', { name: 'Enviar' }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        difficultExerciseDescription: 'Agachamento búlgaro, senti insegurança.',
        durationFit: 'MAIS_CURTOS',
      }),
    );
  });
});
