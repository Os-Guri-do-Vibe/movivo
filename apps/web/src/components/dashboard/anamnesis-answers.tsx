'use client';

/**
 * Respostas da anamnese do aluno, para o profissional que revisa o protocolo. A leitura é
 * auditada pelo servidor; aqui só se traduz o que o aluno respondeu. Busca ao abrir (não ao
 * montar a tela), porque o conteúdo é dado de saúde.
 */
import {
  PAIN_REGION_LABELS,
  PARQ_QUESTION_TEXT,
  PRIMARY_GOAL_LABELS,
  TRAINING_LOCATION_LABELS,
  type AnamnesisAnswersView,
  type ParqQuestionId,
} from '@movivo/shared';
import { ClipboardList } from 'lucide-react';
import { useCallback, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { getExceptionAnamnesis } from '@/lib/control-center-api';

import { ResourceState, useControlCenterResource } from './control-center-ui';

/** Rótulo dos campos que o formulário grava; o que não está aqui aparece com o nome técnico. */
const KEY_LABELS: Record<string, string> = {
  name: 'Nome',
  birthDate: 'Data de nascimento',
  biologicalSex: 'Sexo biológico',
  heightCm: 'Altura (cm)',
  weightKg: 'Peso (kg)',
  phoneNumber: 'WhatsApp',
  email: 'E-mail',
  goal: 'Objetivo',
  kind: 'Tipo',
  primary: 'Objetivo principal',
  motivation: 'Motivação',
  targetWeightKg: 'Peso-alvo (kg)',
  deadline: 'Prazo',
  modalities: 'Modalidades',
  modality: 'Modalidade',
  venue: 'Local',
  level: 'Nível',
  experience: 'Experiência',
  externalSports: 'Esportes que pratica fora',
  sport: 'Esporte',
  label: 'Nome',
  sessionsPerWeek: 'Dias por semana',
  minutesPerSession: 'Minutos por sessão',
  typicalRpe: 'Esforço típico (0 a 10)',
  fixedDays: 'Dias fixos',
  windows: 'Horários disponíveis',
  weekday: 'Dia',
  slot: 'Período',
  maxMinutes: 'Tempo disponível (min)',
  variesWeekly: 'A rotina muda de semana para semana',
  maxSessionsPerWeek: 'Máximo de treinos por semana que topa',
  lifeContext: 'Contexto de vida',
  sleepHoursTypical: 'Horas de sono',
  stressLevel: 'Nível de estresse',
  preferences: 'Preferências',
  priority: 'Prioridade',
  muscleEmphasis: 'Ênfase muscular',
  trainingPreferences: 'Preferências de treino',
  dislikedExercises: 'Exercícios que não gosta',
  conditions: 'Condições de saúde',
  medications: 'Medicamentos em uso',
  professionalGuidance: 'Orientação de profissional',
  pain: 'Dor',
  hasPain: 'Sente dor',
  points: 'Regiões de dor',
  region: 'Região',
  regionOther: 'Qual região',
  intensity: 'Intensidade',
  trend: 'Tendência',
  trigger: 'O que provoca',
  hasProfessionalExplanation: 'Teve explicação de profissional',
  professionalExplanation: 'O que o profissional explicou',
  underMedicalFollowUp: 'Em acompanhamento médico',
  hasAvoidanceRecommendation: 'Recebeu recomendação de evitar algo',
  avoidanceRecommendation: 'O que evitar',
  cookingCapacity: 'Capacidade de cozinhar',
  mealsOutsideHomePerWeek: 'Refeições fora de casa por semana',
  foodBudgetMonthlyBrl: 'Orçamento mensal com comida (R$)',
  mealsPerDay: 'Refeições por dia',
  usualMeals: 'Refeições habituais',
  dietaryRestrictions: 'Restrições alimentares',
  allergies: 'Alergias e intolerâncias',
  allergen: 'Alimento',
  severity: 'Gravidade',
  supplements: 'Suplementos',
  supplementOther: 'Outro suplemento',
  hunger: 'Fome ao longo do dia',
  likedFoods: 'Alimentos de que gosta',
  dislikedFoods: 'Alimentos de que não gosta',
  measurements: 'Medidas',
};

const VALUE_LABELS: Record<string, string> = {
  MALE: 'Masculino',
  FEMALE: 'Feminino',
  STRENGTH: 'Musculação',
  RUNNING: 'Corrida',
  HYBRID: 'Híbrido',
  HYROX: 'Hyrox',
  BEGINNER: 'Iniciante',
  INTERMEDIATE: 'Intermediário',
  ADVANCED: 'Avançado',
  MORNING: 'Manhã',
  AFTERNOON: 'Tarde',
  EVENING: 'Noite',
  MON: 'Segunda',
  TUE: 'Terça',
  WED: 'Quarta',
  THU: 'Quinta',
  FRI: 'Sexta',
  SAT: 'Sábado',
  SUN: 'Domingo',
  MAX_RESULT: 'Máximo resultado',
  BALANCED: 'Equilibrado',
  ENJOYMENT: 'Prazer em treinar',
  IMPROVING: 'Melhorando',
  STABLE: 'Estável',
  WORSENING: 'Piorando',
  UNKNOWN: 'Não sabe',
  LOW: 'Baixo',
  NORMAL: 'Normal',
  HIGH: 'Alto',
  VARIES: 'Varia',
  INTOLERANCE: 'Intolerância',
  ALLERGY: 'Alergia',
  SEVERE_ALLERGY: 'Alergia grave',
  VEGETARIAN: 'Vegetariano',
  VEGAN: 'Vegano',
  LACTOSE_FREE: 'Sem lactose',
  GLUTEN_FREE: 'Sem glúten',
  HALAL: 'Halal',
  KOSHER: 'Kosher',
  CREATINE: 'Creatina',
  WHEY: 'Whey',
  CAFFEINE: 'Cafeína',
  VITAMIN_D: 'Vitamina D',
  OMEGA_3: 'Ômega 3',
  MULTIVITAMIN: 'Multivitamínico',
  ...PRIMARY_GOAL_LABELS,
  ...TRAINING_LOCATION_LABELS,
  ...PAIN_REGION_LABELS,
};

const humanize = (key: string) => KEY_LABELS[key] ?? key;

function formatScalar(value: string | number | boolean | null): string {
  if (value === null) return '—';
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  if (typeof value === 'number') return String(value);
  return VALUE_LABELS[value] ?? (value === '' ? '—' : value);
}

function Value({ value }: { value: unknown }) {
  if (Array.isArray(value)) {
    if (value.length === 0) return <>—</>;
    if (value.every((item) => typeof item !== 'object' || item === null)) {
      return <>{value.map((item) => formatScalar(item as string)).join(', ')}</>;
    }
    return (
      <ul className="space-y-2">
        {value.map((item, index) => (
          <li key={index} className="rounded-lg border border-border p-2">
            <Value value={item} />
          </li>
        ))}
      </ul>
    );
  }
  if (typeof value === 'object' && value !== null) {
    return <Fields data={value as Record<string, unknown>} />;
  }
  return <>{formatScalar(value as string | number | boolean | null)}</>;
}

function Fields({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data).filter(([, value]) => value !== undefined);
  return (
    <dl className="space-y-1.5">
      {entries.map(([key, value]) => (
        <div key={key} className="grid gap-0.5 sm:grid-cols-[14rem_1fr] sm:gap-3">
          <dt className="text-xs text-muted-foreground">{humanize(key)}</dt>
          <dd className="text-label">
            <Value value={value} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Parq({ data }: { data: Record<string, unknown> }) {
  const parq = data.parq as {
    answers?: { questionId: string; answer: boolean; detail?: string }[];
  };
  const declarations = Array.isArray(data.declarations) ? data.declarations.length : 0;
  return (
    <div className="space-y-2">
      <ul className="space-y-2">
        {(parq?.answers ?? []).map((answer) => (
          <li key={answer.questionId} className="text-label">
            <span className="text-muted-foreground">
              {PARQ_QUESTION_TEXT[answer.questionId as ParqQuestionId] ?? answer.questionId}
            </span>{' '}
            <strong className={answer.answer ? 'text-coral' : undefined}>
              {answer.answer ? 'Sim' : 'Não'}
            </strong>
            {answer.detail ? <span className="block text-xs">“{answer.detail}”</span> : null}
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">{declarations} declarações aceitas.</p>
    </div>
  );
}

export function AnamnesisAnswersContent({ view }: { view: AnamnesisAnswersView }) {
  return (
    <div className="space-y-5">
      <p className="text-xs text-muted-foreground">
        {view.flow === 'COMPLEMENTARY' ? 'Anamnese complementar' : 'Anamnese inicial'}
        {view.submittedAt
          ? ` · enviada em ${new Date(view.submittedAt).toLocaleString('pt-BR')}`
          : ''}
      </p>
      {view.steps.map((step) => (
        <section key={step.step} aria-label={step.title}>
          <h3 className="text-label font-semibold">
            {step.step}. {step.title}
          </h3>
          <div className="mt-2">
            {step.step === 9 ? <Parq data={step.data} /> : <Fields data={step.data} />}
          </div>
        </section>
      ))}
    </div>
  );
}

function Loaded({ caseId }: { caseId: string }) {
  const load = useCallback(
    (signal?: AbortSignal) => getExceptionAnamnesis(caseId, signal),
    [caseId],
  );
  const { data, error, forbidden, loading, refresh } = useControlCenterResource(load);
  if (!data) {
    return (
      <ResourceState
        loading={loading}
        error={error}
        forbidden={forbidden}
        onRetry={() => void refresh()}
      />
    );
  }
  return <AnamnesisAnswersContent view={data} />;
}

/** Botão que abre as respostas da anamnese do aluno do caso. */
export function AnamnesisAnswersButton({ caseId }: { caseId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <ClipboardList aria-hidden="true" />
        Ver anamnese
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Respostas da anamnese</DialogTitle>
            <DialogDescription>
              Dado de saúde: o acesso fica registrado na auditoria.
            </DialogDescription>
          </DialogHeader>
          {open ? <Loaded caseId={caseId} /> : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
