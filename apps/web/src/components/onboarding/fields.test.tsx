import * as React from 'react';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  Checkbox,
  ChoiceGroup,
  ClockInput,
  Combobox,
  CurrencyInput,
  FieldHelp,
  FieldLabel,
  QuestionField,
  QuestionStack,
  TextInput,
  UnitInput,
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
    expect(label.parentElement?.parentElement).toHaveClass('gap-2');
    expect(legend.nextElementSibling?.nextElementSibling).toHaveClass('mt-2', 'gap-2');
    expect(screen.getByText('Ajuda da pergunta')).toHaveClass(
      'text-label',
      'text-muted-foreground',
    );
    expect(screen.getByText('Ajuda da escolha')).toHaveClass('text-label', 'text-muted-foreground');
    expect(label.parentElement?.parentElement?.parentElement).toHaveClass('gap-6');
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
    await user.click(screen.getByRole('radio', { name: 'Beta' }));
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
    const beta = screen.getByRole('button', { name: 'Beta' });
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
    expect(screen.getByRole('button', { name: 'Alfa' })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('orientação de cada pergunta', () => {
  const items = [
    { value: 'A', label: 'Alfa' },
    { value: 'B', label: 'Beta' },
    { value: 'C', label: 'Gama' },
  ];

  it('escolha única: obrigatória, 1 opção', () => {
    render(<ChoiceGroup legend="Escolha" items={items} selected={[]} onToggle={vi.fn()} />);
    expect(screen.getByText('Obrigatória · Escolha 1 opção')).toBeInTheDocument();
  });

  it('múltipla sem teto: quantas quiser; opcional quando marcada', () => {
    render(
      <ChoiceGroup
        legend="Escolha"
        items={items}
        selected={[]}
        onToggle={vi.fn()}
        multi
        optional
      />,
    );
    expect(screen.getByText('Opcional · Escolha quantas quiser')).toBeInTheDocument();
  });

  it('múltipla com teto: mostra o limite e a contagem, e bloqueia as demais ao atingi-lo', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(
      <ChoiceGroup
        legend="Escolha"
        items={items}
        selected={['A', 'B']}
        onToggle={onToggle}
        multi
        max={2}
      />,
    );
    expect(screen.getByText('Obrigatória · Escolha até 2 · 2 de 2')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Gama' }));
    expect(onToggle).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Alfa' }));
    expect(onToggle).toHaveBeenCalledWith('A');
  });

  it('o círculo de seleção fica sempre à esquerda do texto', () => {
    render(<ChoiceGroup legend="Escolha" items={items} selected={['A']} onToggle={vi.fn()} />);
    const option = screen.getByRole('radio', { name: 'Alfa' });
    expect(option.firstElementChild).toHaveAttribute('aria-hidden', 'true');
    expect(option.firstElementChild).toHaveTextContent('✓');
    expect(option.firstElementChild).toHaveClass('bg-primary');
  });

  it('campo de texto: indica se é obrigatório ou opcional', () => {
    render(
      <>
        <FieldLabel htmlFor="a">Nome</FieldLabel>
        <FieldLabel htmlFor="b" optional>
          Apelido
        </FieldLabel>
      </>,
    );
    expect(screen.getByText('Obrigatória')).toBeInTheDocument();
    expect(screen.getByText('Opcional')).toBeInTheDocument();
  });

  it('combo de seleção: mostra a orientação e a descrição de cada opção', async () => {
    const user = userEvent.setup();
    render(
      <Combobox
        id="stress"
        legend="Estresse"
        items={[{ value: 'LOW', label: 'Baixo', description: 'Dias tranquilos' }]}
        value={null}
        onChange={vi.fn()}
        optional
      />,
    );
    expect(screen.getByText('Opcional · Escolha 1 opção')).toBeInTheDocument();
    await user.click(screen.getByRole('combobox', { name: 'Estresse' }));
    expect(screen.getByText('Dias tranquilos')).toBeInTheDocument();
  });
});

describe('Combobox de múltipla escolha', () => {
  const items = [
    { value: 'A', label: 'Alfa' },
    { value: 'B', label: 'Beta' },
    { value: 'C', label: 'Gama' },
  ];

  it('continua aberto ao marcar, resume a seleção e respeita o teto', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Combobox
        id="multi"
        legend="Vários"
        items={items}
        multiple
        max={2}
        value={['A', 'B']}
        onChange={onChange}
        optional
      />,
    );
    const trigger = screen.getByRole('combobox', { name: 'Vários' });
    expect(trigger).toHaveTextContent('Alfa, Beta');
    expect(screen.getByText('Opcional · Escolha até 2 · 2 de 2')).toBeInTheDocument();
    await user.click(trigger);
    expect(screen.getByRole('listbox')).toHaveAttribute('aria-multiselectable', 'true');
    await user.click(screen.getByRole('option', { name: 'Gama' }));
    expect(onChange).not.toHaveBeenCalled();
    await user.click(screen.getByRole('option', { name: 'Alfa' }));
    expect(onChange).toHaveBeenCalledWith('A');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('com mais de duas escolhas mostra a contagem', () => {
    render(
      <Combobox
        id="multi"
        legend="Vários"
        items={items}
        multiple
        value={['A', 'B', 'C']}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('combobox', { name: 'Vários' })).toHaveTextContent('3 selecionadas');
  });
});

describe('entradas com máscara', () => {
  it('UnitInput desenha a unidade logo depois do número e guarda só o número', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <UnitInput id="km" unit="km" decimals={1} value="" onChange={onChange} />,
    );
    await user.type(screen.getByRole('textbox'), '3');
    expect(onChange).toHaveBeenCalledWith('3');
    rerender(<UnitInput id="km" unit="km" decimals={1} value="39.9" onChange={onChange} />);
    expect(screen.getByRole('textbox')).toHaveValue('39.9');
    expect(screen.getByRole('textbox').parentElement).toHaveTextContent('39.9km');
  });

  it('UnitInput normaliza vírgula, ignora letras e limita as casas', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<UnitInput id="km" unit="km" decimals={1} value="39." onChange={onChange} />);
    await user.type(screen.getByRole('textbox'), '9x');
    expect(onChange).toHaveBeenLastCalledWith('39.');
    expect(onChange).toHaveBeenCalledWith('39.9');
  });

  it('ClockInput insere os separadores enquanto digita', async () => {
    const user = userEvent.setup();
    function Controlled() {
      const [value, setValue] = React.useState('');
      return (
        <ClockInput id="t" kind="hms" placeholder="hh:mm:ss" value={value} onChange={setValue} />
      );
    }
    render(<Controlled />);
    await user.type(screen.getByPlaceholderText('hh:mm:ss'), '012500');
    expect(screen.getByPlaceholderText('hh:mm:ss')).toHaveValue('01:25:00');
  });

  it('ClockInput de prova passa para h:mm:ss a partir do quinto dígito', async () => {
    const user = userEvent.setup();
    function Controlled() {
      const [value, setValue] = React.useState('');
      return (
        <ClockInput id="t" kind="race" placeholder="mm:ss" value={value} onChange={setValue} />
      );
    }
    render(<Controlled />);
    await user.type(screen.getByPlaceholderText('mm:ss'), '2730');
    expect(screen.getByPlaceholderText('mm:ss')).toHaveValue('27:30');
    await user.clear(screen.getByPlaceholderText('mm:ss'));
    await user.type(screen.getByPlaceholderText('mm:ss'), '10530');
    expect(screen.getByPlaceholderText('mm:ss')).toHaveValue('1:05:30');
  });

  it('CurrencyInput mostra reais com centavos enquanto digita e guarda só os dígitos', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    function Controlled() {
      const [cents, setCents] = React.useState('');
      return (
        <CurrencyInput
          id="b"
          value={cents}
          onChange={(value) => {
            onChange(value);
            setCents(value);
          }}
        />
      );
    }
    render(<Controlled />);
    const input = screen.getByPlaceholderText('R$ 0,00');
    await user.type(input, '150000');
    expect(input).toHaveValue('R$ 1.500,00');
    expect(onChange).toHaveBeenLastCalledWith('150000');
    await user.type(input, '{Backspace}');
    expect(input).toHaveValue('R$ 150,00');
  });

  it('ClockInput apaga o separador junto com o dígito anterior', async () => {
    const user = userEvent.setup();
    function Controlled() {
      const [value, setValue] = React.useState('07:');
      return (
        <ClockInput id="t" kind="sleep" placeholder="hh:mm" value={value} onChange={setValue} />
      );
    }
    render(<Controlled />);
    await user.type(screen.getByPlaceholderText('hh:mm'), '{Backspace}');
    expect(screen.getByPlaceholderText('hh:mm')).toHaveValue('0');
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
