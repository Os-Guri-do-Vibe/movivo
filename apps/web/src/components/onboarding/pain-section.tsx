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
} from './fields';

export interface PainPointData {
  region: PainRegion;
  intensity: number;
  regionOther: string;
}

export interface PainData {
  hasPain: boolean;
  points: PainPointData[];
  trend: PainTrend | null;
  trigger: string;
  hasProfessionalExplanation: boolean;
  professionalExplanation: string;
  underMedicalFollowUp: boolean;
  hasAvoidanceRecommendation: boolean;
  avoidanceRecommendation: string;
}

export const EMPTY_PAIN: PainData = {
  hasPain: false,
  points: [],
  trend: null,
  trigger: '',
  hasProfessionalExplanation: false,
  professionalExplanation: '',
  underMedicalFollowUp: false,
  hasAvoidanceRecommendation: false,
  avoidanceRecommendation: '',
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
        legend="Você sente alguma dor hoje que atrapalha ou preocupa na hora de treinar?"
        value={data.hasPain}
        onChange={(hasPain) => onChange({ ...EMPTY_PAIN, hasPain })}
        indicatorSide="left"
      />

      {data.hasPain && (
        <>
          <p className="rounded-xl bg-secondary p-4 text-body text-petroleo">
            Obrigado por contar. Isso é o que deixa seu treino seguro.
          </p>
          <ChoiceGroup<PainRegion>
            legend="Em qual região você sente dor, desconforto ou limitação?"
            items={REGION_ITEMS}
            selected={regionValues}
            onToggle={toggleRegion}
            multi
            indicatorSide="left"
          />

          {data.points.some((point) => point.region === 'OTHER') && (
            <QuestionField className="border-l-2 border-primary pl-4" aria-live="polite">
              <FieldLabel htmlFor="painRegionOther">Qual é a outra região?</FieldLabel>
              <TextInput
                id="painRegionOther"
                value={data.points.find((point) => point.region === 'OTHER')?.regionOther ?? ''}
                onChange={setOtherRegion}
                placeholder="Ex.: cotovelo esquerdo"
              />
            </QuestionField>
          )}

          {data.points.map((point) => (
            <QuestionField
              key={point.region}
              className="rounded-xl border border-border bg-secondary p-4"
            >
              <FieldLabel htmlFor={`intensity-${point.region}`}>
                Intensidade do desconforto em{' '}
                {point.region === 'OTHER' && point.regionOther.trim()
                  ? point.regionOther.trim()
                  : PAIN_REGION_LABELS[point.region]}
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
                className="h-2 w-full accent-primary"
              />
              <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-3 text-label text-muted-foreground">
                <span>0 · Nenhuma dor</span>
                <span
                  className="font-mono text-h3 font-semibold text-foreground"
                  aria-hidden="true"
                >
                  {point.intensity}
                </span>
                <span className="text-right">10 · Dor muito intensa</span>
              </div>
            </QuestionField>
          ))}

          <ChoiceGroup<PainTrend>
            legend="Esse desconforto está:"
            items={TREND_ITEMS}
            selected={data.trend ? [data.trend] : []}
            onToggle={(trend) => onChange({ ...data, trend })}
            indicatorSide="left"
          />

          <QuestionField>
            <FieldLabel htmlFor="trigger">
              Quais movimentos ou situações provocam o desconforto?
            </FieldLabel>
            <TextArea
              id="trigger"
              value={data.trigger}
              onChange={(trigger) => onChange({ ...data, trigger })}
              maxLength={300}
            />
          </QuestionField>

          <YesNo
            legend="Algum profissional de saúde já te explicou o que é essa dor?"
            value={data.hasProfessionalExplanation}
            onChange={(hasProfessionalExplanation) =>
              onChange({ ...data, hasProfessionalExplanation })
            }
            indicatorSide="left"
          />
          {data.hasProfessionalExplanation && (
            <QuestionField className="border-l-2 border-primary pl-4">
              <FieldLabel htmlFor="professionalExplanation">
                O que ele te disse? Com suas palavras, tudo bem não lembrar o nome exato.
              </FieldLabel>
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
            legend="Você está fazendo acompanhamento médico ou fisioterapêutico?"
            value={data.underMedicalFollowUp}
            onChange={(underMedicalFollowUp) => onChange({ ...data, underMedicalFollowUp })}
            indicatorSide="left"
          />

          <YesNo
            legend="Algum profissional recomendou evitar movimentos ou exercícios específicos?"
            value={data.hasAvoidanceRecommendation}
            onChange={(hasAvoidanceRecommendation) =>
              onChange({ ...data, hasAvoidanceRecommendation })
            }
            indicatorSide="left"
          />
          {data.hasAvoidanceRecommendation && (
            <QuestionField className="border-l-2 border-primary pl-4">
              <FieldLabel htmlFor="avoid">
                Quais movimentos ou exercícios devem ser evitados?
              </FieldLabel>
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
