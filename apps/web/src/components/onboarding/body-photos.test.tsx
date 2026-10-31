import * as React from 'react';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ConsentItemView } from '@/lib/anamnesis-api';

import { BodyPhotosField, type BodyPhotos } from './body-photos';
import type { PoseAngle } from './pose-guide';

export const PHOTOS_CONSENT: ConsentItemView = {
  type: 'BODY_PHOTOS',
  version: 'consent-body-photos-2026-10-v1',
  title: 'Sobre as fotos do seu corpo',
  body: ['As fotos do corpo são **opcionais**.'],
  label: 'Autorizo a MOVIVO a armazenar as fotos.',
  required: false,
};

const onUpload = vi.fn();
const onRemove = vi.fn();
const onSetConsent = vi.fn();

function Controlled({
  accepted = true,
  initialSent = [],
  sex = null,
}: {
  accepted?: boolean;
  initialSent?: PoseAngle[];
  sex?: 'MALE' | 'FEMALE' | null;
}) {
  const [photos, setPhotos] = React.useState<BodyPhotos>({});
  const [sent, setSent] = React.useState<PoseAngle[]>(initialSent);
  const [ok, setOk] = React.useState(accepted);
  return (
    <BodyPhotosField
      photos={photos}
      sentAngles={sent}
      consent={PHOTOS_CONSENT}
      sex={sex}
      consentAccepted={ok}
      onSetConsent={async (value) => {
        await onSetConsent(value);
        setOk(value);
        if (!value) {
          setPhotos({});
          setSent([]);
        }
      }}
      onUpload={async (angle, file) => {
        await onUpload(angle, file);
        setPhotos((prev) => ({ ...prev, [angle]: file }));
        setSent((prev) => [...prev, angle]);
      }}
      onRemove={async (angle) => {
        await onRemove(angle);
        setPhotos((prev) => {
          const next = { ...prev };
          delete next[angle];
          return next;
        });
        setSent((prev) => prev.filter((a) => a !== angle));
      }}
    />
  );
}

beforeEach(() => {
  onUpload.mockReset().mockResolvedValue(undefined);
  onRemove.mockReset().mockResolvedValue(undefined);
  onSetConsent.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => 'blob:preview'),
    revokeObjectURL: vi.fn(),
  });
});

describe('BodyPhotosField', () => {
  it('mostra instruções e a posição de cada foto', () => {
    render(<Controlled />);
    expect(screen.getByText(/Prefere mais cobertura\?/)).toBeInTheDocument();
    expect(screen.getAllByRole('img', { name: /posição da foto/i })).toHaveLength(4);
  });

  it('sem o consentimento próprio, não deixa escolher foto até aceitar', async () => {
    const user = userEvent.setup();
    render(<Controlled accepted={false} />);
    expect(screen.getByText('Sobre as fotos do seu corpo')).toBeInTheDocument();
    expect(screen.getByText('As fotos do corpo são opcionais.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enviar fotos' })).toBeDisabled();
    expect(screen.getByText(/Autorize o uso das fotos acima/)).toBeInTheDocument();
    await user.click(screen.getByLabelText('Autorizo a MOVIVO a armazenar as fotos.'));
    await waitFor(() => expect(onSetConsent).toHaveBeenCalledWith(true));
    expect(screen.getByRole('button', { name: 'Enviar fotos' })).toBeEnabled();
  });

  it('o aceite continua visível depois de autorizar e pode ser retirado, apagando as fotos', async () => {
    const user = userEvent.setup();
    render(<Controlled initialSent={['BACK']} />);
    const checkbox = screen.getByLabelText('Autorizo a MOVIVO a armazenar as fotos.');
    expect(checkbox).toBeChecked();
    expect(screen.getByText('Sobre as fotos do seu corpo')).toBeInTheDocument();
    expect(
      screen.getByText(/Para retirar a autorização, desmarque a opção acima/),
    ).toBeInTheDocument();
    expect(screen.getByText('✓ Enviada')).toBeInTheDocument();

    await user.click(checkbox);
    await waitFor(() => expect(onSetConsent).toHaveBeenCalledWith(false));
    await waitFor(() => expect(checkbox).not.toBeChecked());
    expect(screen.queryByText('✓ Enviada')).not.toBeInTheDocument();
    expect(screen.getByText('Sobre as fotos do seu corpo')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enviar fotos' })).toBeDisabled();
  });

  it('falha ao registrar a escolha mostra o erro e mantém o estado', async () => {
    onSetConsent.mockRejectedValue(new Error('boom'));
    const user = userEvent.setup();
    render(<Controlled accepted={false} />);
    await user.click(screen.getByLabelText('Autorizo a MOVIVO a armazenar as fotos.'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Não conseguimos registrar');
    expect(screen.getByLabelText('Autorizo a MOVIVO a armazenar as fotos.')).not.toBeChecked();
  });

  it('as orientações de roupa de homens e de mulheres ficam sempre à vista', () => {
    for (const sex of ['MALE', 'FEMALE', null] as const) {
      const { unmount } = render(<Controlled sex={sex} />);
      expect(
        screen.getByText(
          'Homens: Bermuda ou sunga e sem camiseta: assim o profissional enxerga o contorno do corpo.',
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          'Mulheres: Biquíni ou shorts e top: assim o profissional enxerga o contorno do corpo.',
        ),
      ).toBeInTheDocument();
      unmount();
    }
  });

  it('o card de aceite vem antes das orientações das fotos', () => {
    render(<Controlled accepted={false} />);
    const consent = screen.getByText('Sobre as fotos do seu corpo');
    const instructions = screen.getByText(/Prefere mais cobertura\?/);
    expect(
      consent.compareDocumentPosition(instructions) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('deixa claro que é opcional e que há alternativa com roupa justa', () => {
    render(<Controlled />);
    expect(screen.getByText(/As fotos são opcionais e a escolha é sua/)).toBeInTheDocument();
    expect(screen.getByText(/Prefere mais cobertura\?/)).toBeInTheDocument();
    expect(screen.getByText(/O rosto pode ficar de fora/)).toBeInTheDocument();
  });

  it('um único botão "Enviar fotos" aceita várias imagens de uma vez', () => {
    render(<Controlled />);
    expect(screen.getAllByRole('button', { name: 'Enviar fotos' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Adicionar foto' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Escolher as fotos do corpo')).toHaveAttribute('multiple');
  });

  it('as imagens escolhidas de uma vez ocupam as posições na ordem e mostram a prévia', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    const files = ['a', 'b', 'c'].map(
      (name) => new File(['x'], `${name}.jpg`, { type: 'image/jpeg' }),
    );
    await user.upload(screen.getByLabelText('Escolher as fotos do corpo'), files);
    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(3));
    expect(onUpload.mock.calls.map(([angle]) => angle)).toEqual(['FRONT', 'RIGHT', 'BACK']);
    expect(await screen.findByRole('img', { name: 'Foto enviada: frontal' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Foto enviada: costas' })).toBeInTheDocument();
    // Só sobra uma posição livre: o próximo envio preenche a que falta.
    await user.upload(
      screen.getByLabelText('Escolher as fotos do corpo'),
      new File(['x'], 'd.jpg', { type: 'image/jpeg' }),
    );
    await waitFor(() => expect(onUpload).toHaveBeenLastCalledWith('LEFT', expect.any(File)));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Enviar fotos' })).toBeDisabled(),
    );
  });

  it('remover uma foto libera a posição', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    await user.upload(
      screen.getByLabelText('Escolher as fotos do corpo'),
      new File(['x'], 'frente.jpg', { type: 'image/jpeg' }),
    );
    await screen.findByRole('img', { name: 'Foto enviada: frontal' });
    await user.click(screen.getByRole('button', { name: 'Remover foto: frontal' }));
    expect(onRemove).toHaveBeenCalledWith('FRONT');
    await waitFor(() =>
      expect(screen.queryByRole('img', { name: 'Foto enviada: frontal' })).not.toBeInTheDocument(),
    );
  });

  it('escolher mais fotos do que há posições livres não envia nenhuma', async () => {
    const user = userEvent.setup();
    render(<Controlled initialSent={['FRONT', 'BACK']} />);
    const files = ['a', 'b', 'c'].map(
      (name) => new File(['x'], `${name}.jpg`, { type: 'image/jpeg' }),
    );
    await user.upload(screen.getByLabelText('Escolher as fotos do corpo'), files);
    expect(await screen.findByRole('alert')).toHaveTextContent('Escolha no máximo 2 fotos');
    expect(onUpload).not.toHaveBeenCalled();
  });

  it('foto já enviada em outra visita aparece como enviada e pode ser removida', async () => {
    const user = userEvent.setup();
    render(<Controlled initialSent={['BACK']} />);
    expect(screen.getByText('✓ Enviada')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remover foto: costas' }));
    expect(onRemove).toHaveBeenCalledWith('BACK');
  });

  it('falha no envio mostra o erro na posição e não mostra a prévia', async () => {
    onUpload.mockRejectedValue(new Error('boom'));
    const user = userEvent.setup();
    render(<Controlled />);
    await user.upload(
      screen.getByLabelText('Escolher as fotos do corpo'),
      new File(['x'], 'costas.png', { type: 'image/png' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Não conseguimos enviar');
    expect(screen.queryByRole('img', { name: /foto enviada/i })).not.toBeInTheDocument();
  });

  it('recusa arquivo que não é imagem aceita e imagem acima de 5 MB sem enviar', () => {
    render(<Controlled />);
    const input = screen.getByLabelText('Escolher as fotos do corpo');
    fireEvent.change(input, {
      target: { files: [new File(['x'], 'doc.pdf', { type: 'application/pdf' })] },
    });
    expect(screen.getByRole('alert')).toHaveTextContent('JPG, PNG ou WebP');
    const big = new File(['x'], 'big.png', { type: 'image/png' });
    Object.defineProperty(big, 'size', { value: 6 * 1024 * 1024 });
    fireEvent.change(input, { target: { files: [big] } });
    expect(screen.getByRole('alert')).toHaveTextContent('5 MB');
    expect(onUpload).not.toHaveBeenCalled();
  });
});
