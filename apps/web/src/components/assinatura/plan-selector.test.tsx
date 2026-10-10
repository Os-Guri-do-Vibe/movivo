import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getCheckoutSummary = vi.fn();
const startCheckoutPayment = vi.fn();

vi.mock('@/lib/subscription-api', () => ({
  getCheckoutSummary: (...args: unknown[]) => getCheckoutSummary(...args),
  startCheckoutPayment: (...args: unknown[]) => startCheckoutPayment(...args),
  formatBRL: (cents: number) => `R$ ${(cents / 100).toFixed(2)}`,
}));

vi.mock('@/lib/landing/site', () => ({
  LEGAL_LINKS: { terms: '/termos', privacy: '/privacidade' },
}));

import { PlanSelector } from './plan-selector';
import { LEGAL_LINKS } from '@/lib/landing/site';

const SEAL = 'Treinos feitos para você. Tecnologia que potencializa. Ciência que orienta.';
const HOSTED_URL = 'https://sandbox.asaas.com/000/checkoutSession/show/chk_1';

const SUMMARY = {
  plan: 'ANNUAL',
  label: 'Anual',
  monthlyCents: 6790,
  totalCents: 81480,
  months: 12,
  maxInstallments: 12,
  status: 'TRIALING',
  expiresAt: '2026-09-26T00:00:00.000Z',
  methods: ['CARD', 'PIX'],
  hostedCard: true,
};

const TITLE = { name: 'Seu próximo passo começa aqui.' };

async function fillPayer(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/Nome completo/), 'Pessoa Teste');
  await user.type(screen.getByLabelText(/E-mail/), 'teste@movivo.test');
  await user.type(screen.getByLabelText(/CPF/), '11144477735');
  await user.type(screen.getByLabelText(/Celular/), '11999999999');
  await user.type(screen.getByLabelText(/CEP/), '01310100');
  await user.type(screen.getByLabelText(/^Número \*/), '100');
  await user.click(screen.getByRole('checkbox'));
}

const assign = vi.fn();
const realLocation = window.location;

beforeEach(() => {
  LEGAL_LINKS.terms = '/termos';
  LEGAL_LINKS.privacy = '/privacidade';
  window.history.replaceState(null, '', '/assinar/opaque');
  assign.mockReset();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: Object.assign(Object.create(Object.getPrototypeOf(realLocation)), {
      href: 'http://localhost/assinar/opaque',
      assign,
    }),
  });
  getCheckoutSummary.mockReset().mockResolvedValue(SUMMARY);
  startCheckoutPayment.mockReset().mockResolvedValue({ status: 'PENDING', method: 'PIX' });
});

afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation });
  vi.useRealTimers();
});

/** `?retorno=` volta do Asaas: a página lê da URL real. */
function comingBack(value: 'sucesso' | 'cancelado' | 'expirado') {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: Object.assign(Object.create(Object.getPrototypeOf(realLocation)), {
      href: `http://localhost/assinar/opaque?retorno=${value}`,
      assign,
    }),
  });
}

describe('checkout MOVIVO — tela única', () => {
  it('mostra o selo da marca e só os dois meios reais, sem campos de cartão', async () => {
    render(<PlanSelector token="opaque" />);
    expect(await screen.findByRole('heading', TITLE)).toBeVisible();
    expect(screen.getByText(SEAL)).toBeVisible();
    expect(screen.getByText('Plano Anual')).toBeVisible();
    expect(screen.getByRole('button', { name: /Cartão/ })).toBeVisible();
    expect(screen.getByRole('button', { name: /Pix à vista/ })).toBeVisible();
    expect(screen.queryByRole('button', { name: /Pix Automático/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Apple Pay|Google Pay/)).not.toBeInTheDocument();
    for (const field of [/Número do cartão/, /CVV/, /Validade/, /Nome impresso/]) {
      expect(screen.queryByLabelText(field)).not.toBeInTheDocument();
    }
  });

  it('pede os dados uma vez só, para Pix e para cartão', async () => {
    const user = userEvent.setup();
    render(<PlanSelector token="opaque" />);
    await screen.findByRole('heading', TITLE);
    expect(screen.getByLabelText(/CPF/)).toBeVisible();
    await user.type(screen.getByLabelText(/Nome completo/), 'Pessoa Teste');
    await user.click(screen.getByRole('button', { name: /Pix à vista/ }));
    expect(screen.getByLabelText(/Nome completo/)).toHaveValue('Pessoa Teste');
    await user.click(screen.getByRole('button', { name: /Cartão/ }));
    expect(screen.getByLabelText(/Nome completo/)).toHaveValue('Pessoa Teste');
  });

  it('sem os documentos legais para aceitar, o checkout não abre', async () => {
    LEGAL_LINKS.terms = null as never;
    render(<PlanSelector token="opaque" />);
    expect(
      await screen.findByText(/contratação paga está temporariamente indisponível/i),
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Continuar para o pagamento seguro' }),
    ).toBeDisabled();
    expect(startCheckoutPayment).not.toHaveBeenCalled();
  });

  it('com os documentos legais publicados, o checkout abre para qualquer titular', async () => {
    render(<PlanSelector token="opaque" />);
    await screen.findByRole('heading', TITLE);
    expect(screen.getByRole('button', { name: 'Continuar para o pagamento seguro' })).toBeEnabled();
  });

  it('cartão: envia só os dados cadastrais e leva o aluno ao Checkout do Asaas na mesma aba', async () => {
    const user = userEvent.setup();
    startCheckoutPayment.mockResolvedValueOnce({
      status: 'PENDING',
      method: 'CARD',
      checkoutUrl: HOSTED_URL,
    });
    render(<PlanSelector token="opaque" />);
    await screen.findByRole('heading', TITLE);
    await fillPayer(user);
    await user.click(screen.getByRole('button', { name: 'Continuar para o pagamento seguro' }));

    await waitFor(() => expect(startCheckoutPayment).toHaveBeenCalledTimes(1));
    const sent = startCheckoutPayment.mock.calls[0]?.[1];
    expect(sent).toMatchObject({
      method: 'CARD',
      installments: 12,
      acceptTerms: true,
      plan: 'ANNUAL',
      payer: {
        name: 'Pessoa Teste',
        cpfCnpj: '11144477735',
        phone: '11999999999',
        postalCode: '01310100',
        addressNumber: '100',
      },
    });
    for (const forbidden of ['card', 'cardNumber', 'ccv', 'number', 'totalCents', 'monthlyCents']) {
      expect(sent).not.toHaveProperty(forbidden);
    }
    await waitFor(() => expect(assign).toHaveBeenCalledWith(HOSTED_URL));
    expect(await screen.findByText('Abrindo o pagamento seguro…')).toBeVisible();
    expect(screen.getByRole('link', { name: /Se nada acontecer/ })).toHaveAttribute(
      'href',
      HOSTED_URL,
    );
  });

  it('Pix: formata os campos, envia o plano persistido e mostra o QR na própria página', async () => {
    const user = userEvent.setup();
    startCheckoutPayment.mockResolvedValueOnce({
      status: 'PENDING',
      method: 'PIX',
      qrCode: {
        encodedImage: 'cG5n',
        payload: 'pix-copia-cola',
        expirationDate: '2999-01-01T00:00:00.000Z',
      },
    });
    render(<PlanSelector token="opaque" />);
    await user.click(await screen.findByRole('button', { name: /Pix à vista/ }));
    await fillPayer(user);
    expect(screen.getByLabelText(/CPF/)).toHaveValue('111.444.777-35');
    expect(screen.getByLabelText(/Celular/)).toHaveValue('(11) 99999-9999');
    expect(screen.getByLabelText(/CEP/)).toHaveValue('01310-100');
    await user.click(screen.getByRole('button', { name: 'Gerar Pix' }));

    await waitFor(() => expect(startCheckoutPayment).toHaveBeenCalledTimes(1));
    const sent = startCheckoutPayment.mock.calls[0]?.[1];
    expect(sent).toMatchObject({
      method: 'PIX',
      payer: expect.objectContaining({ cpfCnpj: '11144477735' }),
      acceptTerms: true,
      plan: 'ANNUAL',
    });
    expect(sent).not.toHaveProperty('totalCents');
    expect(await screen.findByRole('heading', { name: 'Pague com Pix' })).toBeVisible();
    expect(screen.getByText('pix-copia-cola')).toBeVisible();
    expect(assign).not.toHaveBeenCalled();
  });

  describe('troca de plano no checkout', () => {
    it('lista os quatro planos com o persistido (o da landing) pré-selecionado', async () => {
      render(<PlanSelector token="opaque" />);
      await screen.findByRole('heading', TITLE);
      const radios = screen.getAllByRole('radio');
      expect(radios.map((radio) => (radio as HTMLInputElement).value)).toEqual([
        'MONTHLY',
        'QUARTERLY',
        'SEMIANNUAL',
        'ANNUAL',
      ]);
      expect(screen.getByRole('radio', { name: /Anual/ })).toBeChecked();
      expect(screen.getByText('15% OFF')).toBeVisible();
    });

    it('trocar o plano atualiza resumo e total, e envia só o ID do plano escolhido', async () => {
      const user = userEvent.setup();
      render(<PlanSelector token="opaque" />);
      await screen.findByRole('heading', TITLE);

      await user.click(screen.getByRole('radio', { name: /Trimestral/ }));
      expect(screen.getByText('Plano Trimestral')).toBeVisible();
      expect(screen.getAllByText('R$ 227.70').length).toBeGreaterThan(0);

      await user.click(screen.getByRole('button', { name: /Pix à vista/ }));
      await fillPayer(user);
      await user.click(screen.getByRole('button', { name: 'Gerar Pix' }));
      await waitFor(() => expect(startCheckoutPayment).toHaveBeenCalledTimes(1));
      const sent = startCheckoutPayment.mock.calls[0]?.[1];
      expect(sent).toMatchObject({ method: 'PIX', plan: 'QUARTERLY' });
      expect(sent).not.toHaveProperty('totalCents');
    });

    it('o plano mensal explica a cobrança recorrente no cartão', async () => {
      const user = userEvent.setup();
      render(<PlanSelector token="opaque" />);
      await screen.findByRole('heading', TITLE);
      await user.click(screen.getByRole('radio', { name: /Mensal/ }));
      expect(screen.getByText('R$ 79.90 mensal recorrente')).toBeVisible();
      expect(screen.getByText('Mensal, até cancelamento')).toBeVisible();
    });

    it('trocar de plano com o Pix aberto volta ao formulário (o valor mudou)', async () => {
      const user = userEvent.setup();
      startCheckoutPayment.mockResolvedValueOnce({
        status: 'PENDING',
        method: 'PIX',
        qrCode: {
          encodedImage: 'cG5n',
          payload: 'pix-copia-cola',
          expirationDate: '2999-01-01T00:00:00.000Z',
        },
      });
      render(<PlanSelector token="opaque" />);
      await user.click(await screen.findByRole('button', { name: /Pix à vista/ }));
      await fillPayer(user);
      await user.click(screen.getByRole('button', { name: 'Gerar Pix' }));
      await screen.findByRole('heading', { name: 'Pague com Pix' });

      await user.click(screen.getByRole('radio', { name: /Semestral/ }));
      expect(screen.queryByRole('heading', { name: 'Pague com Pix' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Gerar Pix' })).toBeVisible();
    });
  });

  describe('volta do Checkout do Asaas', () => {
    it('?retorno=sucesso confirma o pagamento e libera a tela quando o webhook chega', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      comingBack('sucesso');
      getCheckoutSummary
        .mockResolvedValueOnce({ ...SUMMARY, status: 'PENDING_PAYMENT' })
        .mockResolvedValue({ ...SUMMARY, status: 'ACTIVE' });
      render(<PlanSelector token="opaque" />);
      expect(await screen.findByText('Confirmando seu pagamento…')).toBeVisible();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_100);
      });
      expect(await screen.findByText('Pagamento confirmado')).toBeVisible();
    });

    it('sem confirmação em 90s avisa que o WhatsApp trará o aviso', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      comingBack('sucesso');
      getCheckoutSummary.mockResolvedValue({ ...SUMMARY, status: 'PENDING_PAYMENT' });
      render(<PlanSelector token="opaque" />);
      await screen.findByText('Confirmando seu pagamento…');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(91_000);
      });
      expect(screen.getByText(/você receberá uma mensagem no WhatsApp/i)).toBeVisible();
    });

    it('?retorno=cancelado oferece continuar de onde parou, com o mesmo link', async () => {
      comingBack('cancelado');
      getCheckoutSummary.mockResolvedValue({
        ...SUMMARY,
        status: 'PENDING_PAYMENT',
        checkoutUrl: HOSTED_URL,
      });
      render(<PlanSelector token="opaque" />);
      expect(await screen.findByText(/Você saiu do pagamento seguro/)).toBeVisible();
      expect(
        screen.getByRole('link', { name: 'Continuar para o pagamento seguro' }),
      ).toHaveAttribute('href', HOSTED_URL);
    });

    it('sessão pendente reaberta (sem retorno) também continua de onde parou', async () => {
      getCheckoutSummary.mockResolvedValue({
        ...SUMMARY,
        status: 'PENDING_PAYMENT',
        checkoutUrl: HOSTED_URL,
      });
      render(<PlanSelector token="opaque" />);
      expect(await screen.findByRole('heading', { name: 'Finalize o pagamento' })).toBeVisible();
    });

    it('?retorno=expirado avisa e o próximo envio pede uma sessão nova (regenerate)', async () => {
      const user = userEvent.setup();
      comingBack('expirado');
      getCheckoutSummary.mockResolvedValue({
        ...SUMMARY,
        status: 'PENDING_PAYMENT',
        checkoutUrl: HOSTED_URL,
      });
      startCheckoutPayment.mockResolvedValueOnce({
        status: 'PENDING',
        method: 'CARD',
        checkoutUrl: 'https://sandbox.asaas.com/000/checkoutSession/show/chk_2',
      });
      render(<PlanSelector token="opaque" />);
      expect(await screen.findByText(/O tempo do pagamento seguro acabou/)).toBeVisible();
      await fillPayer(user);
      await user.click(screen.getByRole('button', { name: 'Continuar para o pagamento seguro' }));
      await waitFor(() => expect(startCheckoutPayment).toHaveBeenCalledTimes(1));
      expect(startCheckoutPayment.mock.calls[0]?.[1]).toMatchObject({
        method: 'CARD',
        regenerate: true,
      });
    });

    it('"Gerar novo link" volta ao formulário já pedindo sessão nova', async () => {
      const user = userEvent.setup();
      getCheckoutSummary.mockResolvedValue({
        ...SUMMARY,
        status: 'PENDING_PAYMENT',
        checkoutUrl: HOSTED_URL,
      });
      render(<PlanSelector token="opaque" />);
      await user.click(await screen.findByRole('button', { name: 'Gerar novo link de pagamento' }));
      expect(screen.getByRole('heading', { name: 'Pagamento seguro' })).toBeVisible();
    });
  });

  it('cancelado com acesso pago em curso informa quando dá para assinar de novo', async () => {
    getCheckoutSummary.mockResolvedValue({
      ...SUMMARY,
      status: 'CANCELED',
      repurchaseAt: '2026-12-01T12:00:00.000Z',
    });
    render(<PlanSelector token="opaque" />);
    expect(await screen.findByText(/Sua assinatura foi cancelada/)).toBeVisible();
    expect(screen.getByText(/poderá assinar novamente/)).toBeVisible();
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

  it.each([
    [new Error('request_failed_409'), /tentativa em processamento/i],
    [new Error('request_failed_400'), /revise os dados/i],
    [new Error('network'), /não foi possível iniciar/i],
  ])('traduz falha de início do pagamento', async (failure, message) => {
    const user = userEvent.setup();
    startCheckoutPayment.mockRejectedValueOnce(failure);
    render(<PlanSelector token="opaque" />);
    await user.click(await screen.findByRole('button', { name: /Pix à vista/ }));
    await fillPayer(user);
    await user.click(screen.getByRole('button', { name: 'Gerar Pix' }));
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
    await user.click(screen.getByRole('button', { name: 'Gerar Pix' }));

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

  it('o prazo do Pix acima de uma hora aparece em horas e minutos', async () => {
    const user = userEvent.setup();
    startCheckoutPayment.mockResolvedValueOnce({
      status: 'PENDING',
      method: 'PIX',
      qrCode: {
        encodedImage: 'cG5n',
        payload: 'pix-copia-cola',
        expirationDate: new Date(Date.now() + (26 * 3600 + 5 * 60 + 30) * 1000).toISOString(),
      },
    });
    render(<PlanSelector token="opaque" />);
    await user.click(await screen.findByRole('button', { name: /Pix à vista/ }));
    await fillPayer(user);
    await user.click(screen.getByRole('button', { name: 'Gerar Pix' }));
    expect(await screen.findByText(/Expira em 26 h 0[45] min/)).toBeVisible();
  });

  it('com o Pix aberto dá para trocar para cartão sem sair da página', async () => {
    const user = userEvent.setup();
    startCheckoutPayment.mockResolvedValueOnce({
      status: 'PENDING',
      method: 'PIX',
      qrCode: {
        encodedImage: 'cG5n',
        payload: 'pix-copia-cola',
        expirationDate: '2999-01-01T00:00:00.000Z',
      },
    });
    render(<PlanSelector token="opaque" />);
    await user.click(await screen.findByRole('button', { name: /Pix à vista/ }));
    await fillPayer(user);
    await user.click(screen.getByRole('button', { name: 'Gerar Pix' }));
    await user.click(await screen.findByRole('button', { name: 'Pagar com cartão' }));
    expect(screen.getByRole('heading', { name: 'Pagamento seguro' })).toBeVisible();
  });
});
