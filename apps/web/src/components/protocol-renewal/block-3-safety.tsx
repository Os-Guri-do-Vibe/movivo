'use client';

import * as React from 'react';

import { PAIN_REGION_LABELS, type PainRegion, type PainTrend } from '@movivo/shared';

import {
  ChoiceGroup,
  FieldLabel,
  QuestionField,
  QuestionStack,
  TextArea,
  TextInput,
  YesNo,
} from '@/components/onboarding/fields';
import { BlockFooter, QuestionHeader } from './block-shell';

/** Bloco 3 — segurança: repescagem de PAR-Q (pergunta 9 + 9a-9d, pergunta 10). */
export interface Block3NewPainState {
  hasNewPain: boolean | undefined;
  region: PainRegion | null;
  regionOther: string;
  /** Escala 0-10; começa em 5 (ponto médio), mesma convenção do slider de dor da anamnese. */
  intensity: number;
  trend: PainTrend | null;
  soughtCare: boolean | undefined;
}

export interface Block3ParqRecheckState {
  changedToYes: boolean | undefined;
  detail: string;
}

export interface Block3State {
  newPain: Block3NewPainState;
  parqRecheck: Block3ParqRecheckState;
}

export const EMPTY_BLOCK3: Block3State = {
  newPain: {
    hasNewPain: undefined,
    region: null,
    regionOther: '',
    intensity: 5,
    trend: null,
    soughtCare: undefined,
  },
  parqRecheck: { changedToYes: undefined, detail: '' },
};

const REGION_ITEMS = (Object.keys(PAIN_REGION_LABELS) as PainRegion[]).map((value) => ({
  value,
  label: PAIN_REGION_LABELS[value],
}));

const TREND_ITEMS: { value: PainTrend; label: string }[] = [
  { value: 'IMPROVING', label: 'Melhorando' },
  { value: 'STABLE', label: 'Estável' },
  { value: 'WORSENING', label: 'Piorando' },
  { value: 'UNKNOWN', label: 'Não sei informar' },
];

const TOTAL_QUESTIONS = 2;

function hasText(value: string) {
  return value.trim().length > 0;
}

export function Block3Safety({
  data,
  onChange,
  onContinue,
  onBack,
  initialScreen = 0,
  onScreenChange,
  saving,
}: {
  data: Block3State;
  onChange: (data: Block3State) => void;
  onContinue: () => void;
  onBack?: () => void;
  initialScreen?: number;
  onScreenChange?: (screen: number) => void;
  saving: boolean;
}) {
  const [screen, setScreen] = React.useState(
    Math.min(TOTAL_QUESTIONS - 1, Math.max(0, initialScreen)),
  );
  const titleRef = React.useRef<HTMLHeadingElement>(null);

  React.useEffect(() => {
    titleRef.current?.focus();
  }, [screen]);

  function navigate(next: number) {
    const bounded = Math.min(TOTAL_QUESTIONS - 1, Math.max(0, next));
    setScreen(bounded);
    onScreenChange?.(bounded);
  }

  function setNewPain<K extends keyof Block3NewPainState>(key: K, value: Block3NewPainState[K]) {
    onChange({ ...data, newPain: { ...data.newPain, [key]: value } });
  }

  function setParqRecheck<K extends keyof Block3ParqRecheckState>(
    key: K,
    value: Block3ParqRecheckState[K],
  ) {
    onChange({ ...data, parqRecheck: { ...data.parqRecheck, [key]: value } });
  }

  const newPainComplete =
    data.newPain.hasNewPain === false ||
    (data.newPain.hasNewPain === true &&
      data.newPain.region !== null &&
      (data.newPain.region !== 'OTHER' || hasText(data.newPain.regionOther)) &&
      data.newPain.trend !== null &&
      data.newPain.soughtCare !== undefined);

  const parqRecheckComplete =
    data.parqRecheck.changedToYes === false ||
    (data.parqRecheck.changedToYes === true && hasText(data.parqRecheck.detail));

  const screenComplete = [newPainComplete, parqRecheckComplete][screen];

  return (
    <div className="flex flex-col gap-6 pb-4">
      {screen === 0 && (
        <section className="flex flex-col gap-6" aria-labelledby="block3-title">
          <QuestionHeader
            index={1}
            total={TOTAL_QUESTIONS}
            titleId="block3-title"
            titleRef={titleRef}
          >
            Você sentiu alguma dor, desconforto ou limitação NOVA durante os treinos deste ciclo,
            algo que não tinha antes?
          </QuestionHeader>
          <YesNo
            legend="Selecione uma resposta"
            value={data.newPain.hasNewPain}
            onChange={(hasNewPain) =>
              onChange({
                ...data,
                newPain: { ...EMPTY_BLOCK3.newPain, hasNewPain },
              })
            }
            indicatorSide="left"
          />

          {data.newPain.hasNewPain && (
            <QuestionStack aria-live="polite">
              <QuestionField className="border-l-2 border-primary pl-4">
                <ChoiceGroup<PainRegion>
                  legend="Em qual região?"
                  items={REGION_ITEMS}
                  selected={data.newPain.region ? [data.newPain.region] : []}
                  onToggle={(region) => setNewPain('region', region)}
                  indicatorSide="left"
                />
              </QuestionField>

              {data.newPain.region === 'OTHER' && (
                <QuestionField className="border-l-2 border-primary pl-4">
                  <FieldLabel htmlFor="newPainRegionOther">Qual é a outra região?</FieldLabel>
                  <TextInput
                    id="newPainRegionOther"
                    value={data.newPain.regionOther}
                    onChange={(value) => setNewPain('regionOther', value)}
                    maxLength={100}
                    placeholder="Ex.: cotovelo esquerdo"
                  />
                </QuestionField>
              )}

              <QuestionField className="rounded-xl border border-border bg-secondary p-4">
                <FieldLabel htmlFor="newPainIntensity">Intensidade (0-10)</FieldLabel>
                <input
                  id="newPainIntensity"
                  type="range"
                  min={0}
                  max={10}
                  step={1}
                  value={data.newPain.intensity}
                  onChange={(e) => setNewPain('intensity', Number(e.target.value))}
                  aria-valuetext={`${data.newPain.intensity} de 10`}
                  className="h-2 w-full accent-primary"
                />
                <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-3 text-label text-muted-foreground">
                  <span>0 · Nenhuma dor</span>
                  <span
                    className="font-mono text-h3 font-semibold text-foreground"
                    aria-hidden="true"
                  >
                    {data.newPain.intensity}
                  </span>
                  <span className="text-right">10 · Dor muito intensa</span>
                </div>
              </QuestionField>

              <ChoiceGroup<PainTrend>
                legend="Está:"
                items={TREND_ITEMS}
                selected={data.newPain.trend ? [data.newPain.trend] : []}
                onToggle={(trend) => setNewPain('trend', trend)}
                indicatorSide="left"
              />

              <YesNo
                legend="Já procurou avaliação médica ou fisioterapêutica por causa disso?"
                value={data.newPain.soughtCare}
                onChange={(soughtCare) => setNewPain('soughtCare', soughtCare)}
                indicatorSide="left"
              />
            </QuestionStack>
          )}
        </section>
      )}

      {screen === 1 && (
        <section className="flex flex-col gap-6" aria-labelledby="block3-title">
          <QuestionHeader
            index={2}
            total={TOTAL_QUESTIONS}
            titleId="block3-title"
            titleRef={titleRef}
          >
            Alguma pergunta do questionário de segurança que você respondeu &quot;Não&quot; antes
            mudaria para &quot;Sim&quot; hoje? (ex.: novo problema de saúde, nova medicação contínua
            para pressão/coração, gravidez, cirurgia recente)
          </QuestionHeader>
          <p className="rounded-xl border border-coral bg-coral/10 p-4 text-body text-petroleo">
            Se a resposta for &quot;sim&quot;, tudo bem. Isso apenas faz com que um profissional
            responsável olhe seu caso antes de o próximo protocolo ser liberado.
          </p>
          <YesNo
            legend="Selecione uma resposta"
            value={data.parqRecheck.changedToYes}
            onChange={(changedToYes) =>
              onChange({ ...data, parqRecheck: { changedToYes, detail: '' } })
            }
            indicatorSide="left"
          />
          {data.parqRecheck.changedToYes && (
            <QuestionField className="border-l-2 border-primary pl-4" aria-live="polite">
              <FieldLabel htmlFor="parqRecheckDetail">Conte o que mudou</FieldLabel>
              <TextArea
                id="parqRecheckDetail"
                value={data.parqRecheck.detail}
                onChange={(detail) => setParqRecheck('detail', detail)}
                maxLength={500}
              />
            </QuestionField>
          )}
        </section>
      )}

      <BlockFooter
        onBack={screen > 0 ? () => navigate(screen - 1) : onBack}
        onContinue={() => (screen < TOTAL_QUESTIONS - 1 ? navigate(screen + 1) : onContinue())}
        disabled={!screenComplete}
        saving={saving}
      />
    </div>
  );
}
