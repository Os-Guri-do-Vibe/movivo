import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getCheckoutSummary = vi.fn();
const startCheckoutPayment = vi.fn();

vi.mock('@/lib/subscription-api', () => ({
  getCheckoutSummary: (...args: unknown[]) => getCheckoutSummary(...args),
  startCheckoutPayment: (...args: unknown[]) => startCheckoutPayment(...args),
  formatBRL: (cents: number) => `R$ ${(cents / 100).toFixed(2)}`,
}));

import { PlanSelector } from './plan-selector';

const SUMMARY = {
  plan: 'ANNUAL',
  label: 'Anual',
  monthlyCents: 6790,
  totalCents: 81480,
  months: 12,
  maxInstallments: 12,
  status: 'TRIALING',
  expiresAt: '2026-09-26T00:00:00.000Z',
  methods: ['CARD', 'PIX', 'PIX_AUTOMATIC'],
};

async function fillPayer(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/Nome completo/), 'Pessoa Teste');
  await user.type(screen.getByLabelText(/E-mail/), 'teste@movivo.test');
  await user.type(screen.getByLabelText(/CPF/), '11144477735');
  await user.type(screen.getByLabelText(/Celular/), '11999999999');
  await user.type(screen.getByLabelText(/CEP/), '01310100');
  await user.type(screen.getByLabelText(/^Número \*/), '100');
  await user.click(screen.getByRole('checkbox'));
}

beforeEach(() => {
  getCheckoutSummary.mockReset().mockResolvedValue(SUMMARY);
  startCheckoutPayment.mockReset().mockResolvedValue({ status: 'PENDING', method: 'PIX' });
});

describe('checkout MOVIVO', () => {
  it('carrega o plano fixado no backend, os três meios reais e nenhuma carteira falsa', async () => {
    render(<PlanSelector token="opaque" />);
    expect(
      await screen.findByRole('heading', { name: 'Seu próximo passo começa aqui.' }),
    ).toBeVisible();
    expect(screen.getByText('Plano Anual')).toBeVisible();
    expect(screen.getByRole('button', { name: /Cartão/ })).toBeVisible();
    expect(screen.getByRole('button', { name: /Pix à vista/ })).toBeVisible();
    expect(screen.getByRole('button', { name: /Pix Automático/ })).toBeVisible();
    expect(screen.queryByText(/Apple Pay|Google Pay/)).not.toBeInTheDocument();
  });

  it('envia Pix sem permitir alterar plano ou preço no cliente', async () => {
    const user = userEvent.setup();
    render(<PlanSelector token="opaque" />);
    await user.click(await screen.findByRole('button', { name: /Pix à vista/ }));
    await user.type(screen.getByLabelText(/Nome completo/), 'Pessoa Teste');
    await user.type(screen.getByLabelText(/E-mail/), 'teste@movivo.test');
    await user.type(screen.getByLabelText(/CPF/), '11144477735');
    await user.type(screen.getByLabelText(/Celular/), '11999999999');
    await user.type(screen.getByLabelText(/CEP/), '01310100');
    expect(screen.getByLabelText(/CPF/)).toHaveValue('111.444.777-35');
    expect(screen.getByLabelText(/Celular/)).toHaveValue('(11) 99999-9999');
    expect(screen.getByLabelText(/CEP/)).toHaveValue('01310-100');
    await user.type(screen.getByLabelText(/^Número \*/), '100');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Pagar com Pix' }));

    await waitFor(() => expect(startCheckoutPayment).toHaveBeenCalledTimes(1));
    expect(startCheckoutPayment).toHaveBeenCalledWith(
      'opaque',
      expect.objectContaining({
        method: 'PIX',
        payer: expect.objectContaining({ cpfCnpj: '11144477735' }),
        acceptTerms: true,
      }),
    );
    const sent = startCheckoutPayment.mock.calls[0]?.[1];
    expect(sent).not.toHaveProperty('plan');
    expect(sent).not.toHaveProperty('totalCents');
  });

  it('formata a validade como MM/AA e converte o ano antes de enviar ao Asaas', async () => {
    const user = userEvent.setup();
    startCheckoutPayment.mockResolvedValueOnce({ status: 'PENDING', method: 'CARD' });
    render(<PlanSelector token="opaque" />);

    await screen.findByRole('heading', { name: 'Seu próximo passo começa aqui.' });
    await user.type(screen.getByLabelText(/Nome completo/), 'Pessoa Teste');
    await user.type(screen.getByLabelText(/E-mail/), 'teste@movivo.test');
    await user.type(screen.getByLabelText(/CPF/), '11144477735');
    await user.type(screen.getByLabelText(/Celular/), '11999999999');
    await user.type(screen.getByLabelText(/CEP/), '01310100');
    await user.type(screen.getByLabelText(/^Número \*/), '100');
    await user.type(screen.getByLabelText(/Nome impresso/), 'PESSOA TESTE');
    await user.type(screen.getByLabelText(/Número do cartão/), '4111111111111111');
    expect(screen.getByRole('status', { name: 'Bandeira Visa detectada' })).toBeVisible();
    await user.type(screen.getByLabelText(/Validade/), '1230');
    await user.type(screen.getByLabelText(/CVV/), '123');
    expect(screen.getByLabelText(/Validade/)).toHaveValue('12/30');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Confirmar assinatura' }));

    await waitFor(() => expect(startCheckoutPayment).toHaveBeenCalledTimes(1));
    expect(startCheckoutPayment).toHaveBeenCalledWith(
      'opaque',
      expect.objectContaining({
        method: 'CARD',
        payer: expect.objectContaining({
          cpfCnpj: '11144477735',
          phone: '11999999999',
          postalCode: '01310100',
        }),
        card: expect.objectContaining({ expiryMonth: '12', expiryYear: '2030' }),
      }),
    );
  });

  it('atualiza a bandeira do cartão conforme o número é digitado', async () => {
    const user = userEvent.setup();
    render(<PlanSelector token="opaque" />);
    const cardNumber = await screen.findByLabelText(/Número do cartão/);

    await user.type(cardNumber, '5555');
    expect(screen.getByRole('status', { name: 'Bandeira Mastercard detectada' })).toBeVisible();

    await user.clear(cardNumber);
    await user.type(cardNumber, '3714');
    expect(
      screen.getByRole('status', { name: 'Bandeira American Express detectada' }),
    ).toBeVisible();

    for (const [number, label] of [
      ['401178', 'Elo'],
      ['606282', 'Hipercard'],
      ['6011', 'Discover'],
      ['3528', 'JCB'],
      ['2221', 'Mastercard'],
    ] as const) {
      await user.clear(cardNumber);
      await user.type(cardNumber, number);
      expect(screen.getByRole('status', { name: `Bandeira ${label} detectada` })).toBeVisible();
    }
  });

  it('mostra falha fatal quando o link não pode ser carregado', async () => {
    getCheckoutSummary.mockRejectedValueOnce(new Error('expired'));
    render(<PlanSelector token="expired" />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/link é inválido ou expirou/i);
  });

  it('mostra sucesso imediatamente para uma assinatura já ativa', async () => {
    getCheckoutSummary.mockResolvedValueOnce({ ...SUMMARY, status: 'ACTIVE' });
    render(<PlanSelector token="active" />);
    expect(await screen.findByText('Pagamento confirmado')).toBeVisible();
  });

  it('expõe recusa do Pix Automático sem alterar o contrato escolhido', async () => {
    const user = userEvent.setup();
    startCheckoutPayment.mockResolvedValueOnce({ status: 'REFUSED', method: 'PIX_AUTOMATIC' });
    render(<PlanSelector token="opaque" />);
    await user.click(await screen.findByRole('button', { name: /Pix Automático/ }));
    await fillPayer(user);
    await user.click(screen.getByRole('button', { name: 'Autorizar Pix Automático' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/não foi aprovado/i);
    expect(startCheckoutPayment).toHaveBeenCalledWith(
      'opaque',
      expect.objectContaining({ method: 'PIX_AUTOMATIC' }),
    );
  });

  it.each([
    [new Error('conflict_409'), /tentativa em processamento/i],
    [new Error('network'), /não foi possível iniciar/i],
  ])('traduz falha de início do pagamento', async (failure, message) => {
    const user = userEvent.setup();
    startCheckoutPayment.mockRejectedValueOnce(failure);
    render(<PlanSelector token="opaque" />);
    await user.click(await screen.findByRole('button', { name: /Pix à vista/ }));
    await fillPayer(user);
    await user.click(screen.getByRole('button', { name: 'Pagar com Pix' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
  });

  it('copia o Pix e regenera um QR Code expirado', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    startCheckoutPayment
      .mockResolvedValueOnce({
        status: 'PENDING',
        method: 'PIX',
        qrCode: {
          encodedImage: 'cG5n',
          payload: 'pix-copia-cola',
          expirationDate: '2020-01-01T00:00:00.000Z',
        },
      })
      .mockResolvedValueOnce({ status: 'PENDING', method: 'PIX' });
    render(<PlanSelector token="opaque" />);
    await user.click(await screen.findByRole('button', { name: /Pix à vista/ }));
    await fillPayer(user);
    await user.click(screen.getByRole('button', { name: 'Pagar com Pix' }));

    await user.click(await screen.findByRole('button', { name: 'Copiar' }));
    expect(writeText).toHaveBeenCalledWith('pix-copia-cola');
    expect(screen.getByRole('button', { name: 'Copiado' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: /Gerar novo QR Code/ }));
    await waitFor(() => expect(startCheckoutPayment).toHaveBeenCalledTimes(2));
    expect(startCheckoutPayment.mock.calls[1]?.[1]).toMatchObject({
      method: 'PIX',
      regenerate: true,
    });
  });
});
