'use client';

import * as React from 'react';

import { PAIN_REGION_LABELS, type PainRegion, type PainTrend } from '@movivo/shared';

import { TREND_ITEMS } from './anamnesis-options';
import {
  ChoiceGroup,
  FieldHelp,
  FieldLabel,
  FieldValidation,
  QuestionField,
  QuestionStack,
  TextArea,
  TextInput,
  YesNo,
} from './fields';

export interface PainPointData {
  region: PainRegion;
  intensity: number;
  regionOther: string;
}

export interface PainData {
  /** `undefined` = ainda não respondeu. */
  hasPain: boolean | undefined;
  points: PainPointData[];
  trend: PainTrend | null;
  trigger: string;
  hasProfessionalExplanation: boolean | undefined;
  professionalExplanation: string;
  underMedicalFollowUp: boolean | undefined;
  hasAvoidanceRecommendation: boolean | undefined;
  avoidanceRecommendation: string;
}

export const EMPTY_PAIN: PainData = {
  hasPain: undefined,
  points: [],
  trend: null,
  trigger: '',
  hasProfessionalExplanation: undefined,
  professionalExplanation: '',
  underMedicalFollowUp: undefined,
  hasAvoidanceRecommendation: undefined,
  avoidanceRecommendation: '',
};

const REGION_ITEMS = (Object.keys(PAIN_REGION_LABELS) as PainRegion[]).map((value) => ({
  value,
  label: PAIN_REGION_LABELS[value],
}));

/**
 * Seção 4 — dores e limitações (Sofia §6-7). "Não" encerra a seção (pergunta-porta);
 * "Sim" revela regiões (múltipla escolha), uma escala 0-10 POR região (não uma média
 * geral — Sofia §7.1), tendência e os condicionais de explicação/acompanhamento.
 */
export function PainSection({
  data,
  onChange,
}: {
  data: PainData;
  onChange: (data: PainData) => void;
}) {
  const regionValues = data.points.map((p) => p.region);

  function toggleRegion(region: PainRegion) {
    const exists = data.points.some((p) => p.region === region);
    onChange({
      ...data,
      points: exists
        ? data.points.filter((p) => p.region !== region)
        : [...data.points, { region, intensity: 5, regionOther: '' }],
    });
  }

  function setIntensity(region: PainRegion, intensity: number) {
    onChange({
      ...data,
      points: data.points.map((p) => (p.region === region ? { ...p, intensity } : p)),
    });
  }

  function setOtherRegion(regionOther: string) {
    onChange({
      ...data,
      points: data.points.map((point) =>
        point.region === 'OTHER' ? { ...point, regionOther } : point,
      ),
    });
  }

  return (
    <QuestionStack>
      <YesNo
        legend="Hoje, você sente alguma dor ou desconforto que atrapalha ou te preocupa na hora de treinar?"
        value={data.hasPain}
        onChange={(hasPain) => onChange({ ...EMPTY_PAIN, hasPain })}
      />

      {data.hasPain && (
        <>
          <p className="-mt-2 rounded-xl bg-accent/70 px-4 py-3 text-body text-petroleo">
            Obrigado por contar. Com essas respostas, o treino já começa respeitando o que você
            sente.
          </p>
          <ChoiceGroup<PainRegion>
            legend="Em quais regiões do corpo?"
            items={REGION_ITEMS}
            selected={regionValues}
            onToggle={toggleRegion}
            multi
          />

          {data.points.some((point) => point.region === 'OTHER') && (
            <QuestionField className="border-l-2 border-primary pl-4" aria-live="polite">
              <FieldLabel htmlFor="painRegionOther">Qual é a outra região?</FieldLabel>
              <FieldValidation
                error={
                  data.points.find((point) => point.region === 'OTHER')?.regionOther.trim()
                    ? undefined
                    : 'Escreva qual é a região.'
                }
              >
                <TextInput
                  id="painRegionOther"
                  value={data.points.find((point) => point.region === 'OTHER')?.regionOther ?? ''}
                  onChange={setOtherRegion}
                  placeholder="Ex.: cotovelo esquerdo"
                  maxLength={100}
                />
              </FieldValidation>
            </QuestionField>
          )}

          {data.points.map((point) => (
            <QuestionField
              key={point.region}
              className="rounded-2xl border border-border bg-white p-4 shadow-[0_1px_2px_rgba(6,48,42,0.05)] sm:p-5"
            >
              <FieldLabel htmlFor={`intensity-${point.region}`} hint="Deslize de 0 a 10">
                {point.region === 'OTHER' && point.regionOther.trim()
                  ? point.regionOther.trim()
                  : PAIN_REGION_LABELS[point.region]}
                : quanto incomoda hoje?
              </FieldLabel>
              <input
                id={`intensity-${point.region}`}
                type="range"
                min={0}
                max={10}
                step={1}
                value={point.intensity}
                onChange={(e) => setIntensity(point.region, Number(e.target.value))}
                aria-valuetext={`${point.intensity} de 10`}
                className="onboarding-range"
                style={{ '--range-fill': `${point.intensity * 10}%` } as React.CSSProperties}
              />
              <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-3 text-label text-muted-foreground">
                <span>0 · Não incomoda</span>
                <span
                  className="font-mono text-h2 font-semibold leading-none tabular-nums text-petroleo"
                  aria-hidden="true"
                >
                  {point.intensity}
                </span>
                <span className="text-right">10 · Dor muito intensa</span>
              </div>
            </QuestionField>
          ))}

          <ChoiceGroup<PainTrend>
            legend="Nas últimas semanas, como esse desconforto tem evoluído?"
            items={TREND_ITEMS}
            selected={data.trend ? [data.trend] : []}
            onToggle={(trend) => onChange({ ...data, trend })}
          />

          <QuestionField>
            <FieldLabel htmlFor="trigger" optional>
              O que costuma provocar ou piorar o desconforto?
            </FieldLabel>
            <FieldHelp>Ex.: agachar, correr na descida, ficar muito tempo sentado.</FieldHelp>
            <TextArea
              id="trigger"
              value={data.trigger}
              onChange={(trigger) => onChange({ ...data, trigger })}
              maxLength={300}
            />
          </QuestionField>

          <YesNo
            legend="Algum profissional de saúde já te explicou o que é esse desconforto?"
            value={data.hasProfessionalExplanation}
            onChange={(hasProfessionalExplanation) =>
              onChange({ ...data, hasProfessionalExplanation })
            }
          />
          {data.hasProfessionalExplanation && (
            <QuestionField className="border-l-2 border-primary pl-4">
              <FieldLabel htmlFor="professionalExplanation">O que foi explicado?</FieldLabel>
              <FieldHelp>Com as suas palavras. Tudo bem não lembrar o nome exato.</FieldHelp>
              <TextArea
                id="professionalExplanation"
                value={data.professionalExplanation}
                onChange={(professionalExplanation) =>
                  onChange({ ...data, professionalExplanation })
                }
                maxLength={500}
              />
            </QuestionField>
          )}

          <YesNo
            legend="Hoje, você faz acompanhamento com médico ou fisioterapeuta por causa disso?"
            value={data.underMedicalFollowUp}
            onChange={(underMedicalFollowUp) => onChange({ ...data, underMedicalFollowUp })}
          />

          <YesNo
            legend="Algum profissional de saúde pediu para você evitar algum movimento ou exercício por causa disso?"
            value={data.hasAvoidanceRecommendation}
            onChange={(hasAvoidanceRecommendation) =>
              onChange({ ...data, hasAvoidanceRecommendation })
            }
          />
          {data.hasAvoidanceRecommendation && (
            <QuestionField className="border-l-2 border-primary pl-4">
              <FieldLabel htmlFor="avoid">O que foi pedido para evitar?</FieldLabel>
              <TextArea
                id="avoid"
                value={data.avoidanceRecommendation}
                onChange={(avoidanceRecommendation) =>
                  onChange({ ...data, avoidanceRecommendation })
                }
                maxLength={500}
              />
            </QuestionField>
          )}
          <p className="text-label text-muted-foreground">
            Seus dados ficam protegidos e só o profissional de Educação Física responsável tem
            acesso.
          </p>
        </>
      )}
    </QuestionStack>
  );
}
