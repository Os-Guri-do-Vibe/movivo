'use client';

import * as React from 'react';

import { PAIN_REGION_LABELS, type PainRegion, type PainTrend } from '@movivo/shared';

import { ChoiceGroup, FieldLabel, TextArea, YesNo } from './fields';

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
 * geral — Sofia §7.1), tendência e os condicionais de diagnóstico/acompanhamento.
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

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-h2 font-semibold">Seção 4 — Dores e limitações</h2>

      <YesNo
        legend="Você sente atualmente alguma dor, desconforto ou limitação de movimento?"
        value={data.hasPain}
        onChange={(hasPain) => onChange({ ...EMPTY_PAIN, hasPain })}
      />

      {data.hasPain && (
        <>
          <ChoiceGroup<PainRegion>
            legend="Em qual região você sente dor, desconforto ou limitação?"
            items={REGION_ITEMS}
            selected={regionValues}
            onToggle={toggleRegion}
            multi
          />

          {data.points.map((point) => (
            <div key={point.region} className="flex flex-col gap-2 rounded-lg border border-input p-4">
              <FieldLabel htmlFor={`intensity-${point.region}`}>
                Intensidade do desconforto em {PAIN_REGION_LABELS[point.region]}
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
              <div className="flex justify-between text-label text-muted-foreground">
                <span>0 — Nenhum desconforto</span>
                <span className="font-semibold text-foreground">{point.intensity}</span>
                <span>10 — Desconforto muito intenso</span>
              </div>
            </div>
          ))}

          <ChoiceGroup<PainTrend>
            legend="Esse desconforto está:"
            items={TREND_ITEMS}
            selected={data.trend ? [data.trend] : []}
            onToggle={(trend) => onChange({ ...data, trend })}
          />

          <div className="flex flex-col gap-2">
            <FieldLabel htmlFor="trigger">Quais movimentos ou situações provocam o desconforto?</FieldLabel>
            <TextArea id="trigger" value={data.trigger} onChange={(trigger) => onChange({ ...data, trigger })} />
          </div>

          <YesNo
            legend="Você possui diagnóstico para essa condição?"
            value={data.hasProfessionalExplanation}
            onChange={(hasProfessionalExplanation) =>
              onChange({ ...data, hasProfessionalExplanation })
            }
          />
          {data.hasProfessionalExplanation && (
            <div className="flex flex-col gap-2">
              <FieldLabel htmlFor="diagnosis">Qual é o diagnóstico?</FieldLabel>
              <TextArea
                id="diagnosis"
                value={data.professionalExplanation}
                onChange={(professionalExplanation) =>
                  onChange({ ...data, professionalExplanation })
                }
              />
            </div>
          )}

          <YesNo
            legend="Você está fazendo acompanhamento médico ou fisioterapêutico?"
            value={data.underMedicalFollowUp}
            onChange={(underMedicalFollowUp) => onChange({ ...data, underMedicalFollowUp })}
          />

          <YesNo
            legend="Algum profissional recomendou evitar movimentos ou exercícios específicos?"
            value={data.hasAvoidanceRecommendation}
            onChange={(hasAvoidanceRecommendation) =>
              onChange({ ...data, hasAvoidanceRecommendation })
            }
          />
          {data.hasAvoidanceRecommendation && (
            <div className="flex flex-col gap-2">
              <FieldLabel htmlFor="avoid">Quais movimentos ou exercícios devem ser evitados?</FieldLabel>
              <TextArea
                id="avoid"
                value={data.avoidanceRecommendation}
                onChange={(avoidanceRecommendation) =>
                  onChange({ ...data, avoidanceRecommendation })
                }
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
