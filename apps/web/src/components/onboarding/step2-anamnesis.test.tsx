import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Step2Anamnesis, EMPTY_STEP2, type Step2State } from './step2-anamnesis';

const COMPLETE: Step2State = {
  ...EMPTY_STEP2,
  primaryGoal: 'GAIN_MUSCLE',
  trainingStatus: 'REGULAR',
  experience: 'BEGINNER',
  daysPerWeek: 3,
  sessionDuration: 'M45_TO_60',
  location: 'HOME',
  preferredPeriod: 'MORNING',
};

function renderStep2(data: Step2State = COMPLETE, onChange = vi.fn(), onContinue = vi.fn()) {
  render(<Step2Anamnesis data={data} onChange={onChange} onContinue={onContinue} saving={false} />);
  return { onChange, onContinue };
}

describe('Step2Anamnesis', () => {
  it('objetivo "Outro" revela o campo de texto livre', async () => {
    const user = userEvent.setup();
    renderStep2({ ...COMPLETE, primaryGoal: null });
    await user.click(screen.getByRole('radio', { name: 'Outro' }));
  });

  it('mostra o campo de texto quando primaryGoal já é OTHER', () => {
    renderStep2({ ...COMPLETE, primaryGoal: 'OTHER' });
    expect(screen.getByLabelText('Conte para nós qual é o seu objetivo')).toBeInTheDocument();
  });

  it('"Estou parado" revela a pergunta de há quanto tempo', () => {
    renderStep2({ ...COMPLETE, trainingStatus: 'STOPPED' });
    expect(screen.getByText('Há quanto tempo você não treina?')).toBeInTheDocument();
  });

  it('CONTINUAR desabilitado quando faltam campos obrigatórios', () => {
    renderStep2(EMPTY_STEP2);
    expect(screen.getByRole('button', { name: 'CONTINUAR' })).toBeDisabled();
  });

  it('CONTINUAR habilitado quando os campos obrigatórios estão completos', async () => {
    const user = userEvent.setup();
    const { onContinue } = renderStep2();
    const button = screen.getByRole('button', { name: 'CONTINUAR' });
    expect(button).toBeEnabled();
    await user.click(button);
    expect(onContinue).toHaveBeenCalled();
  });

  it('"Corpo todo, sem preferência" é exclusiva com as demais regiões', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderStep2(COMPLETE, onChange);
    await user.click(screen.getByText('Corpo todo, sem preferência'));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ emphasis: ['FULL_BODY'] }));
  });

  it('seção de dor: responder "Sim" mantém o CONTINUAR desabilitado até escolher região e tendência', async () => {
    const user = userEvent.setup();
    renderStep2({ ...COMPLETE, pain: { ...COMPLETE.pain, hasPain: true } });
    expect(screen.getByRole('button', { name: 'CONTINUAR' })).toBeDisabled();
    await user.click(screen.getByText('Pescoço'));
  });

  it('exercita as escolhas múltiplas e os condicionais restantes das seções 2/3/5', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderStep2(COMPLETE, onChange);

    await user.click(screen.getByText('Corrida'));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ pastActivities: ['WALK_RUN'] }),
    );

    await user.click(screen.getByText('Outra'));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ pastActivities: expect.arrayContaining(['OTHER']) }),
    );

    await user.click(screen.getByRole('button', { name: 'Não saber o que fazer' }));
    await user.click(screen.getByRole('button', { name: 'Segunda' }));
    await user.click(screen.getByRole('button', { name: 'Terça' }));

    const [firstSim] = screen.getAllByText('Sim'); // hasImportantEvent
    await user.click(firstSim as HTMLElement);
    const lastSim = screen.getAllByText('Sim').at(-1); // practicesOtherSport ou hasAvoidedExercise
    await user.click(lastSim as HTMLElement);
  });

  it('desmarcar uma atividade/barreira já selecionada remove do array', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderStep2({ ...COMPLETE, pastActivities: ['CYCLING'], consistencyBarriers: ['COST'] }, onChange);
    await user.click(screen.getByText('Ciclismo'));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ pastActivities: [] }));
    await user.click(screen.getByRole('button', { name: 'Nunca tentei manter uma rotina' }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ consistencyBarriers: [] }));
  });

  it('emphasis: escolher 2 regiões distintas e depois uma 3ª não ultrapassa o limite', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderStep2({ ...COMPLETE, emphasis: ['CHEST'] }, onChange);
    await user.click(screen.getByText('Costas'));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ emphasis: ['CHEST', 'BACK'] }),
    );
  });

  it('desmarcar uma região de ênfase já selecionada remove do array', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderStep2({ ...COMPLETE, emphasis: ['CHEST'] }, onChange);
    await user.click(screen.getByText('Peitoral'));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ emphasis: [] }));
  });

  it('praticar outro esporte revela nome + dias por semana', () => {
    renderStep2({ ...COMPLETE, practicesOtherSport: true });
    expect(screen.getByLabelText(/qual atividade você pratica/i)).toBeInTheDocument();
  });

  it('evitar exercício revela o campo de texto', () => {
    renderStep2({ ...COMPLETE, hasAvoidedExercise: true });
    expect(screen.getByLabelText('Qual exercício você prefere evitar?')).toBeInTheDocument();
  });

  it('data/evento importante revela data e descrição', () => {
    renderStep2({ ...COMPLETE, hasImportantEvent: true });
    expect(screen.getByLabelText('Qual é a data?')).toBeInTheDocument();
    expect(screen.getByLabelText('Qual é o evento ou resultado esperado?')).toBeInTheDocument();
  });
});
