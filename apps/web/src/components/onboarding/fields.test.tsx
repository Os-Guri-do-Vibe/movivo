import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  Checkbox,
  ChoiceGroup,
  Combobox,
  FieldHelp,
  FieldLabel,
  QuestionField,
  QuestionStack,
  TextInput,
  YesNo,
} from './fields';

describe('Combobox', () => {
  it('abre a lista padronizada e comunica a opção escolhida', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Combobox
        id="experience"
        legend="Qual é a sua experiência?"
        items={[
          { value: 'BEGINNER', label: 'Iniciante' },
          { value: 'ADVANCED', label: 'Avançado' },
        ]}
        value={null}
        onChange={onChange}
      />,
    );
    const trigger = screen.getByRole('combobox', { name: 'Qual é a sua experiência?' });

    expect(screen.getByText('Qual é a sua experiência?')).toHaveClass(
      'text-body',
      'font-semibold',
      'text-foreground',
    );
    expect(trigger).toHaveClass('h-[52px]', 'rounded-xl', 'border-input', 'bg-white');
    await user.click(trigger);
    expect(screen.getByRole('listbox', { name: 'Qual é a sua experiência?' })).toHaveClass(
      'rounded-2xl',
      'bg-nevoa',
    );
    await user.click(screen.getByRole('option', { name: 'Avançado' }));

    expect(onChange).toHaveBeenCalledWith('ADVANCED');
    expect(trigger).toHaveFocus();
  });
});

describe('ChoiceGroup', () => {
  it('padroniza título, ajuda e distância até o controle com campos de texto', () => {
    render(
      <QuestionStack>
        <QuestionField>
          <FieldLabel htmlFor="name">Pergunta de texto</FieldLabel>
          <FieldHelp>Ajuda da pergunta</FieldHelp>
          <TextInput id="name" value="" onChange={vi.fn()} />
        </QuestionField>
        <ChoiceGroup
          legend="Pergunta de escolha"
          help="Ajuda da escolha"
          items={[{ value: 'A', label: 'Alfa' }]}
          selected={[]}
          onToggle={vi.fn()}
        />
      </QuestionStack>,
    );

    const label = screen.getByText('Pergunta de texto');
    const legend = screen.getByText('Pergunta de escolha');
    expect(label.className).toBe(legend.className);
    expect(label).toHaveClass('text-body', 'font-semibold', 'text-foreground');
    expect(label.parentElement).toHaveClass('gap-2');
    expect(legend.nextElementSibling).toHaveClass('mt-2', 'gap-2');
    expect(screen.getByText('Ajuda da pergunta')).toHaveClass(
      'text-label',
      'text-muted-foreground',
    );
    expect(screen.getByText('Ajuda da escolha')).toHaveClass('text-label', 'text-muted-foreground');
    expect(label.parentElement?.parentElement).toHaveClass('gap-6');
  });

  it('single-select: escolher um item chama onToggle com o valor', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(
      <ChoiceGroup
        legend="Objetivo"
        items={[
          { value: 'A', label: 'Alfa' },
          { value: 'B', label: 'Beta' },
        ]}
        selected={[]}
        onToggle={onToggle}
      />,
    );
    await user.click(screen.getByText('Beta'));
    expect(onToggle).toHaveBeenCalledWith('B');
  });

  it('multi-select: itens em disabledValues ficam aria-disabled e não podem ser acionados', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(
      <ChoiceGroup
        items={[
          { value: 'A', label: 'Alfa' },
          { value: 'B', label: 'Beta' },
        ]}
        selected={['A']}
        onToggle={onToggle}
        multi
        disabledValues={['B']}
      />,
    );
    const beta = screen.getByText('Beta');
    expect(beta).toHaveAttribute('aria-disabled', 'true');
    await user.click(beta);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('marca o item selecionado com aria-pressed (multi) ou aria-checked (single)', () => {
    render(
      <ChoiceGroup
        items={[{ value: 'A', label: 'Alfa' }]}
        selected={['A']}
        onToggle={vi.fn()}
        multi
      />,
    );
    expect(screen.getByText('Alfa')).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('YesNo', () => {
  it('Sim chama onChange(true) e Não chama onChange(false)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<YesNo legend="Pergunta?" value={undefined} onChange={onChange} />);
    await user.click(screen.getByText('Sim'));
    expect(onChange).toHaveBeenCalledWith(true);
    await user.click(screen.getByText('Não'));
    expect(onChange).toHaveBeenCalledWith(false);
  });
});

describe('Checkbox', () => {
  it('alterna o estado ao clicar no label', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Checkbox id="c1" checked={false} onChange={onChange}>
        Aceito os termos
      </Checkbox>,
    );
    await user.click(screen.getByLabelText('Aceito os termos'));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe('TextInput', () => {
  it('dispara onChange com o valor digitado', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TextInput id="name" value="" onChange={onChange} />);
    await user.type(screen.getByRole('textbox'), 'a');
    expect(onChange).toHaveBeenCalledWith('a');
  });
});
