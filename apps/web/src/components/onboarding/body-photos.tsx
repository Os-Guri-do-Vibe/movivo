'use client';

import * as React from 'react';
import { Upload, X } from 'lucide-react';

import type { BiologicalSex } from '@movivo/shared';

import { describeAnamnesisError, type ConsentItemView } from '@/lib/anamnesis-api';

import { Checkbox, QuestionMeta } from './fields';
import { POSE_LABELS, PoseGuide, type PoseAngle, type PoseGuideSex } from './pose-guide';
import { ConsentLabel } from './step1-registration';

const ANGLES: readonly PoseAngle[] = ['FRONT', 'RIGHT', 'BACK', 'LEFT'];
const ACCEPTED = 'image/jpeg,image/png,image/webp';
const MAX_BYTES = 5 * 1024 * 1024;

/** Fotos escolhidas nesta aba (a prévia); as já enviadas em outra visita não voltam do servidor. */
export type BodyPhotos = Partial<Record<PoseAngle, File>>;

const CLOTHING_MALE =
  'Bermuda ou sunga e sem camiseta: assim o profissional enxerga o contorno do corpo.';
const CLOTHING_FEMALE =
  'Biquíni ou shorts e top: assim o profissional enxerga o contorno do corpo.';

/** Orientações das fotos: a roupa de cada sexo vem sempre à vista. */
function instructions(): string[] {
  const clothing = [`Homens: ${CLOTHING_MALE}`, `Mulheres: ${CLOTHING_FEMALE}`];
  return [
    ...clothing,
    'Prefere mais cobertura? Use roupa de ginástica bem justa ao corpo (short de compressão, legging, top). A leitura fica menos precisa, mas ainda serve para acompanhar a sua evolução.',
    'Fique em um lugar bem iluminado, com a luz de frente (de preferência natural), fundo liso e sem espelho. Sem filtro e sem flash.',
    'Apoie o celular na vertical, na altura do umbigo, a cerca de 2 metros, com o corpo inteiro de cabeça aos pés. O rosto pode ficar de fora, se preferir.',
    'Fique em pé e relaxado, com os braços soltos ao lado do corpo, pés na largura dos ombros e olhar à frente. Sem contrair nem posar. Cabelo preso e sem acessórios grandes.',
    'Tire todas as fotos no mesmo horário (de manhã, antes de comer, é o ideal) e nas mesmas condições, para comparar a evolução.',
  ];
}

function PhotoTile({
  angle,
  sex,
  file,
  sent,
  busy,
  error,
  onRemove,
}: {
  angle: PoseAngle;
  sex: PoseGuideSex;
  file: File | undefined;
  /** Já existe foto desta posição no servidor. */
  sent: boolean;
  busy: boolean;
  error: string | undefined;
  onRemove: () => void;
}) {
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  return (
    <li className="flex min-w-0 flex-col gap-2">
      <div className="relative aspect-[1/2] w-full overflow-hidden rounded-xl">
        {previewUrl ? (
          <span
            role="img"
            aria-label={`Foto enviada: ${POSE_LABELS[angle].toLowerCase()}`}
            data-photo={angle}
            className="block h-full w-full rounded-xl border border-border bg-cover bg-center"
            style={{ backgroundImage: `url(${previewUrl})` }}
          />
        ) : (
          <PoseGuide angle={angle} sex={sex} />
        )}
        {busy && (
          <span className="absolute inset-0 flex items-center justify-center bg-white/70 text-label font-semibold text-petroleo">
            Enviando…
          </span>
        )}
        {sent && !busy && !previewUrl && (
          <span className="absolute inset-x-1 bottom-1 rounded-lg bg-primary px-1 py-0.5 text-center text-[0.6875rem] font-semibold text-primary-foreground">
            ✓ Enviada
          </span>
        )}
        {(sent || file) && !busy && (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remover foto: ${POSE_LABELS[angle].toLowerCase()}`}
            className="absolute right-1 top-1 flex size-7 items-center justify-center rounded-full bg-petroleo/85 text-white outline-none transition-colors hover:bg-petroleo focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        )}
      </div>
      <p className="flex min-h-8 items-center justify-center text-center text-label font-semibold leading-4 text-petroleo">
        {POSE_LABELS[angle]}
      </p>
      {error && (
        <p role="alert" className="text-center text-label text-petroleo">
          {error}
        </p>
      )}
    </li>
  );
}

/**
 * Fotos do corpo (frontal, lados e costas), com instruções e a posição de cada uma. O envio só
 * abre depois do consentimento próprio das fotos; cada foto sobe assim que é escolhida.
 */
export function BodyPhotosField({
  photos,
  sentAngles,
  sex,
  consent,
  consentAccepted,
  onSetConsent,
  onUpload,
  onRemove,
}: {
  photos: BodyPhotos;
  sentAngles: readonly PoseAngle[];
  /** Sexo informado no cadastro: define a roupa sugerida e o corpo do guia. */
  sex: BiologicalSex | null;
  consent: ConsentItemView;
  consentAccepted: boolean;
  /** Aceita ou retira o consentimento das fotos (retirar apaga as já enviadas). */
  onSetConsent: (accepted: boolean) => Promise<void>;
  onUpload: (angle: PoseAngle, file: File) => Promise<void>;
  onRemove: (angle: PoseAngle) => Promise<void>;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [updatingConsent, setUpdatingConsent] = React.useState(false);
  const [consentError, setConsentError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<ReadonlySet<PoseAngle>>(new Set());
  const [errors, setErrors] = React.useState<Partial<Record<PoseAngle, string>>>({});
  const [selectionError, setSelectionError] = React.useState<string | null>(null);
  const guideSex: PoseGuideSex = sex === 'MALE' ? 'male' : 'female';

  const occupied = (angle: PoseAngle) => sentAngles.includes(angle) || Boolean(photos[angle]);
  const freeAngles = ANGLES.filter((angle) => !occupied(angle));

  function markBusy(angle: PoseAngle, on: boolean) {
    setBusy((previous) => {
      const next = new Set(previous);
      if (on) next.add(angle);
      else next.delete(angle);
      return next;
    });
  }

  async function runFor(angle: PoseAngle, action: () => Promise<void>, failure: string) {
    markBusy(angle, true);
    setErrors((previous) => ({ ...previous, [angle]: undefined }));
    try {
      await action();
    } catch (err) {
      // O 400 das fotos é redigido na API (tamanho, formato, autorização pendente).
      const message = describeAnamnesisError(err, failure, { trustBadRequest: true });
      setErrors((previous) => ({ ...previous, [angle]: message }));
    } finally {
      markBusy(angle, false);
    }
  }

  /** As fotos escolhidas de uma vez ocupam as posições livres, na ordem das posições. */
  function pickFiles(selected: File[]) {
    setSelectionError(null);
    if (selected.length === 0) return;
    if (
      selected.some(
        (file) =>
          !ACCEPTED.split(',').includes(file.type) || file.size === 0 || file.size > MAX_BYTES,
      )
    ) {
      setSelectionError('Use imagens JPG, PNG ou WebP de até 5 MB cada.');
      return;
    }
    if (selected.length > freeAngles.length) {
      setSelectionError(
        freeAngles.length === 0
          ? 'As quatro posições já têm foto. Remova uma para trocar.'
          : `Escolha no máximo ${freeAngles.length} ${freeAngles.length === 1 ? 'foto' : 'fotos'}: as outras posições já têm foto.`,
      );
      return;
    }
    selected.forEach((file, index) => {
      const angle = freeAngles[index];
      if (angle) {
        void runFor(angle, () => onUpload(angle, file), 'Não conseguimos enviar. Tente de novo.');
      }
    });
  }

  async function setConsent(accepted: boolean) {
    setUpdatingConsent(true);
    setConsentError(null);
    try {
      await onSetConsent(accepted);
    } catch (err) {
      setConsentError(
        describeAnamnesisError(err, 'Não conseguimos registrar a sua escolha. Tente de novo.'),
      );
    } finally {
      setUpdatingConsent(false);
    }
  }

  return (
    <section aria-labelledby="body-photos-title" className="flex flex-col gap-4">
      <div className="flex flex-col gap-0.5">
        <h2 id="body-photos-title" className="text-body font-semibold text-foreground">
          Fotos do corpo
        </h2>
        <QuestionMeta optional hint="Até 4 fotos" />
      </div>
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-secondary/40 p-4">
        {consent.title && <h3 className="text-body font-semibold">{consent.title}</h3>}
        {consent.body.map((paragraph) => (
          <p key={paragraph.slice(0, 32)} className="text-label text-muted-foreground">
            {paragraph.replaceAll('**', '')}
          </p>
        ))}
        <Checkbox
          id="consent-BODY_PHOTOS"
          checked={consentAccepted}
          onChange={(checked) => {
            if (!updatingConsent) void setConsent(checked);
          }}
        >
          <ConsentLabel consent={consent} />
        </Checkbox>
        {consentAccepted && (
          <p className="text-label text-muted-foreground">
            Para retirar a autorização, desmarque a opção acima. As fotos já enviadas serão
            apagadas.
          </p>
        )}
        {consentError && (
          <p role="alert" className="text-label text-petroleo">
            {consentError}
          </p>
        )}
      </div>

      <p className="text-label text-muted-foreground">
        As fotos são opcionais e a escolha é sua. Elas ajudam o profissional a comparar a sua
        evolução ao longo do tempo: quanto mais o corpo estiver à mostra, mais precisa é a leitura.
        Só você e os profissionais responsáveis veem as imagens, que ficam criptografadas e nunca
        são usadas em divulgação.
      </p>
      <ul className="flex list-disc flex-col gap-1 pl-5 text-label text-muted-foreground">
        {instructions().map((instruction) => (
          <li key={instruction}>{instruction}</li>
        ))}
      </ul>

      <ol className="grid grid-cols-4 gap-2 sm:gap-3">
        {ANGLES.map((angle) => (
          <PhotoTile
            key={angle}
            angle={angle}
            sex={guideSex}
            file={photos[angle]}
            sent={sentAngles.includes(angle)}
            busy={busy.has(angle)}
            error={errors[angle]}
            onRemove={() =>
              void runFor(angle, () => onRemove(angle), 'Não conseguimos apagar. Tente de novo.')
            }
          />
        ))}
      </ol>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED}
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-label="Escolher as fotos do corpo"
        onChange={(event) => {
          pickFiles(Array.from(event.target.files ?? []));
          event.target.value = '';
        }}
      />
      <button
        type="button"
        disabled={!consentAccepted || freeAngles.length === 0 || busy.size > 0}
        onClick={() => inputRef.current?.click()}
        className="flex h-[52px] w-full items-center justify-center gap-2 rounded-xl border border-input bg-white px-6 text-body font-semibold text-petroleo transition-colors hover:bg-secondary disabled:opacity-50"
      >
        <Upload aria-hidden="true" className="size-5" />
        Enviar fotos
      </button>
      <p className="text-center text-label text-muted-foreground">
        {consentAccepted
          ? 'Selecione as fotos de uma vez, nesta ordem: frontal, lado direito, costas e lado esquerdo.'
          : 'Para enviar fotos, marque a autorização acima.'}
      </p>
      {selectionError && (
        <p role="alert" className="text-center text-label text-petroleo">
          {selectionError}
        </p>
      )}
    </section>
  );
}
