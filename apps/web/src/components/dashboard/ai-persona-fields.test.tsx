import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  FieldError,
  FieldWarning,
  LockedBlock,
  RadioCards,
  SwitchField,
  WhatsappBubble,
} from './ai-persona-fields';

const OPTIONS = [
  { value: 'A', label: 'Opção A', hint: 'exemplo A' },
  { value: 'B', label: 'Opção B', hint: 'exemplo B' },
] as const;

describe('FieldError / FieldWarning', () => {
  it('FieldError expõe role="alert" com o texto', () => {
    render(<FieldError id="campo-erro">Mensagem obrigatória</FieldError>);
    expect(screen.getByRole('alert')).toHaveTextContent('Mensagem obrigatória');
  });

  it('FieldWarning expõe role="status" (não bloqueia)', () => {
    render(<FieldWarning>Aviso não bloqueante</FieldWarning>);
    expect(screen.getByRole('status')).toHaveTextContent('Aviso não bloqueante');
  });
});

describe('RadioCards', () => {
  it('sem description: não renderiza o parágrafo extra', () => {
    render(
      <RadioCards legend="Escolha" name="grp" value="A" options={OPTIONS} onChange={vi.fn()} />,
    );
    expect(screen.getByText('Escolha')).toBeVisible();
    expect(screen.queryByText(/descrição/i)).not.toBeInTheDocument();
  });

  it('com description: renderiza o texto extra', () => {
    render(
      <RadioCards
        legend="Escolha"
        description="descrição do grupo"
        name="grp"
        value="A"
        options={OPTIONS}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText('descrição do grupo')).toBeVisible();
  });

  it('marca a opção vigente e troca ao clicar; disabled bloqueia a interação', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <RadioCards legend="Escolha" name="grp" value="A" options={OPTIONS} onChange={onChange} />,
    );
    const radioA = screen.getByRole('radio', { name: /Opção A/ });
    const radioB = screen.getByRole('radio', { name: /Opção B/ });
    expect(radioA).toBeChecked();
    expect(radioB).not.toBeChecked();

    await user.click(radioB);
    expect(onChange).toHaveBeenCalledWith('B');

    rerender(
      <RadioCards
        legend="Escolha"
        name="grp"
        value="A"
        options={OPTIONS}
        disabled
        onChange={onChange}
      />,
    );
    expect(radioA).toBeDisabled();
  });
});

describe('SwitchField', () => {
  it('desligado: aria-checked=false, sem o ícone de check, alterna ao clicar', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SwitchField label="Ativar" hint="dica" checked={false} onChange={onChange} />);
    const toggle = screen.getByRole('switch', { name: 'Ativar' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    await user.click(toggle);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('ligado + disabled: aria-checked=true e o botão fica desabilitado', () => {
    render(<SwitchField label="Ativar" hint="dica" checked disabled onChange={vi.fn()} />);
    const toggle = screen.getByRole('switch', { name: 'Ativar' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(toggle).toBeDisabled();
  });
});

describe('LockedBlock', () => {
  it('sem children: renderiza só título e descrição', () => {
    render(<LockedBlock title="Bloqueado" description="Nenhum painel muda isto." />);
    expect(screen.getByText('Bloqueado')).toBeVisible();
    expect(screen.getByText('Nenhum painel muda isto.')).toBeVisible();
  });

  it('com children: renderiza o conteúdo extra', () => {
    render(
      <LockedBlock title="Bloqueado" description="Nenhum painel muda isto.">
        <p>Conteúdo travado</p>
      </LockedBlock>,
    );
    expect(screen.getByText('Conteúdo travado')).toBeVisible();
  });
});

describe('WhatsappBubble', () => {
  it('usa a legenda padrão quando nenhuma é informada', () => {
    render(<WhatsappBubble agentName="Léo" text="Oi!" />);
    expect(
      screen.getByText('Exemplo ilustrativo — não é uma resposta real do modelo.'),
    ).toBeVisible();
  });

  it('usa a legenda customizada quando informada', () => {
    render(<WhatsappBubble agentName="Léo" text="Oi!" caption="Legenda customizada" />);
    expect(screen.getByText('Legenda customizada')).toBeVisible();
  });
});
