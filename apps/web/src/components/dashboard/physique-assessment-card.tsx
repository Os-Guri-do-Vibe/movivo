'use client';

/**
 * Avaliação física por foto na ficha do aluno: a leitura que a IA fez das fotos, para o
 * profissional AUDITAR (ele não atende o aluno). Somente leitura, e as imagens nunca chegam aqui.
 *
 * Ordem de leitura, do resumo ao detalhe: cabeçalho (data, selo, confiança e margem), gordura
 * corporal em faixa e a variação, mapa dos 9 grupos musculares, os 7 segmentos de postura,
 * simetria e destaques, limitações e o aviso. A cor só reforça: todo status tem texto e ícone
 * (WCAG 1.4.1), e "marcante" ganha uma barra lateral sóbria, não um alarme.
 */
import {
  PHYSIQUE_MUSCLE_LABELS,
  POSTURE_REGION_LABELS,
  physiqueMuscleRegionSchema,
  postureRegionSchema,
  type PhotoAngle,
  type PhotoAssessmentAudit,
  type PhotoAssessmentPostureDegree,
  type PhysiqueMuscleStatus,
  type StudentPhotoAssessments,
} from '@movivo/shared';
import {
  ChevronsUp,
  Equal,
  EyeOff,
  Info,
  Minus,
  Sprout,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { FOCUS_RING } from './control-center-table';

const dateOnly = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'UTC' });
const decimal = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

/** `YYYY-MM-DD` sem deslocar o dia pelo fuso. */
export function formatAssessedOn(day: string): string {
  return dateOnly.format(new Date(`${day}T12:00:00Z`));
}

const CONFIDENCE_LABEL: Record<PhotoAssessmentAudit['confidence'], string> = {
  LOW: 'Baixa',
  MEDIUM: 'Média',
};

const ANGLE_LABEL: Record<PhotoAngle, string> = {
  FRONT: 'Frente',
  RIGHT: 'Lado direito',
  BACK: 'Costas',
  LEFT: 'Lado esquerdo',
};

interface TagStyle {
  label: string;
  icon: LucideIcon;
  className: string;
}

/** Status de grupo muscular. Coral fica fora: "a desenvolver" não é alerta. */
const MUSCLE_STATUS: Record<PhysiqueMuscleStatus, TagStyle> = {
  STRENGTH: {
    label: 'Ponto forte',
    icon: ChevronsUp,
    className: 'bg-accent text-accent-foreground',
  },
  BALANCED: {
    label: 'Equilibrado',
    icon: Equal,
    className: 'bg-secondary text-secondary-foreground',
  },
  TO_DEVELOP: {
    label: 'A desenvolver',
    icon: Sprout,
    className: 'border border-input text-foreground',
  },
  NOT_ASSESSABLE: {
    label: 'Não avaliável',
    icon: EyeOff,
    className: 'border border-dashed border-border text-muted-foreground',
  },
};

const NO_READING: TagStyle = {
  label: 'Sem leitura',
  icon: Minus,
  className: 'border border-dashed border-border text-muted-foreground',
};

const POSTURE_DEGREE: Record<PhotoAssessmentPostureDegree, TagStyle> = {
  NONE_VISIBLE: {
    label: 'Sem alteração visível',
    icon: Minus,
    className: 'bg-secondary text-secondary-foreground',
  },
  MILD: {
    label: 'Leve',
    icon: Info,
    className: 'border border-input text-foreground',
  },
  NOTABLE: {
    label: 'Marcante',
    icon: TriangleAlert,
    className: 'border border-coral font-semibold text-foreground',
  },
};

function Tag({ style }: { style: TagStyle }) {
  const Icon = style.icon;
  return (
    <span
      className={cn(
        'inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 text-xs font-medium',
        style.className,
      )}
    >
      <Icon aria-hidden="true" className="size-3.5" />
      {style.label}
    </span>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-t border-border pt-4">
      <h3 className="text-label font-semibold">{title}</h3>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function TextList({ items, empty }: { items: readonly string[]; empty: string }) {
  if (items.length === 0) return <p className="text-xs text-muted-foreground">{empty}</p>;
  return (
    <ul className="list-disc space-y-1 pl-5 text-label">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

const midpoint = (range: { min: number; max: number }) => (range.min + range.max) / 2;

/** Variação da faixa em relação à anterior, dita com a margem de erro por perto. */
function fatVariation(
  current: PhotoAssessmentAudit,
  previous: PhotoAssessmentAudit,
): string | null {
  const now = current.bodyFatRange;
  const before = previous.bodyFatRange;
  if (!now || !before) return null;
  const when = formatAssessedOn(previous.assessedOn);
  const delta = Math.round((midpoint(now) - midpoint(before)) * 10) / 10;
  const overlap = now.min <= before.max && before.min <= now.max;
  const range = `${decimal.format(before.min)}% a ${decimal.format(before.max)}%`;
  if (delta === 0) return `Mesmo ponto médio da avaliação de ${when} (${range}).`;
  const direction = delta < 0 ? 'abaixo' : 'acima';
  const sentence = `Ponto médio ${decimal.format(Math.abs(delta))} p.p. ${direction} da avaliação de ${when} (${range}).`;
  return overlap
    ? `${sentence} As faixas se sobrepõem: a variação fica dentro da margem de erro.`
    : sentence;
}

function Header({ assessment }: { assessment: PhotoAssessmentAudit }) {
  const range = assessment.bodyFatRange;
  const margin = range ? (range.max - range.min) / 2 : null;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-label font-semibold">
          Avaliação de {formatAssessedOn(assessment.assessedOn)}
        </p>
        <span className="inline-flex h-6 items-center rounded-full border border-input px-2 text-xs font-medium">
          Leitura da IA, para auditoria
        </span>
      </div>
      <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <div className="flex gap-1">
          <dt>Confiança:</dt>
          <dd className="font-medium text-foreground">{CONFIDENCE_LABEL[assessment.confidence]}</dd>
        </div>
        <div className="flex gap-1">
          <dt>Margem de erro:</dt>
          <dd className="font-medium text-foreground">
            {margin === null ? 'não estimada' : `± ${decimal.format(margin)} p.p. na faixa`}
          </dd>
        </div>
        <div className="flex gap-1">
          <dt>Fotos lidas:</dt>
          <dd className="font-medium text-foreground">{assessment.photoCount}</dd>
        </div>
      </dl>
    </div>
  );
}

function BodyFat({
  assessment,
  previous,
}: {
  assessment: PhotoAssessmentAudit;
  previous: PhotoAssessmentAudit | null;
}) {
  const range = assessment.bodyFatRange;
  const variation = previous ? fatVariation(assessment, previous) : null;
  return (
    <Block title="Gordura corporal">
      {range ? (
        <p className="text-h3 font-bold tabular-nums">
          {decimal.format(range.min)}% a {decimal.format(range.max)}%
          <span className="ml-2 text-xs font-normal text-muted-foreground">faixa estimada</span>
        </p>
      ) : (
        <p className="text-label text-muted-foreground">As fotos não permitiram estimar a faixa.</p>
      )}
      {variation ? <p className="mt-1 text-xs">{variation}</p> : null}
      {assessment.comparisonSummary ? (
        <p className="mt-1 text-xs text-muted-foreground">
          Comparação da IA: {assessment.comparisonSummary}
        </p>
      ) : null}
    </Block>
  );
}

function MuscleMap({
  groups,
}: {
  groups: NonNullable<PhotoAssessmentAudit['physique']>['muscleGroups'];
}) {
  const byRegion = new Map(groups.map((group) => [group.region, group]));
  const count = (status: PhysiqueMuscleStatus) => groups.filter((g) => g.status === status).length;
  const summary = [
    plural(count('STRENGTH'), 'ponto forte', 'pontos fortes'),
    plural(count('BALANCED'), 'equilibrado', 'equilibrados'),
    `${count('TO_DEVELOP')} a desenvolver`,
    plural(count('NOT_ASSESSABLE'), 'não avaliável', 'não avaliáveis'),
  ].join(' · ');
  return (
    <Block title="Grupos musculares">
      <p className="text-xs text-muted-foreground">{summary}</p>
      <ul className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {physiqueMuscleRegionSchema.options.map((region) => {
          const group = byRegion.get(region);
          return (
            <li key={region} className="rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-label font-semibold">{PHYSIQUE_MUSCLE_LABELS[region]}</span>
                <Tag style={group ? MUSCLE_STATUS[group.status] : NO_READING} />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {group?.note ?? 'A leitura não trouxe este grupo.'}
              </p>
            </li>
          );
        })}
      </ul>
    </Block>
  );
}

function Posture({ items }: { items: NonNullable<PhotoAssessmentAudit['physique']>['posture'] }) {
  const byRegion = new Map(items.map((item) => [item.region, item]));
  const notable = items.filter((item) => item.degree === 'NOTABLE').length;
  return (
    <Block title="Postura">
      <p className="text-xs text-muted-foreground">
        {notable === 0
          ? 'Nenhum segmento com alteração marcante.'
          : `${plural(notable, 'segmento', 'segmentos')} com alteração marcante.`}
      </p>
      <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
        {postureRegionSchema.options.map((region) => {
          const item = byRegion.get(region);
          const isNotable = item?.degree === 'NOTABLE';
          return (
            <li
              key={region}
              className={cn(
                'grid gap-1 p-3 sm:grid-cols-[11rem_12rem_1fr] sm:items-start sm:gap-3',
                isNotable && 'border-l-4 border-l-coral',
              )}
            >
              <span className="text-label font-semibold">{POSTURE_REGION_LABELS[region]}</span>
              <span>
                <Tag style={item ? POSTURE_DEGREE[item.degree] : NO_READING} />
              </span>
              <span className="text-xs">
                {item ? (
                  <>
                    <span className="block">{item.finding}</span>
                    <span className="mt-0.5 block text-muted-foreground">
                      Visto em:{' '}
                      {item.seenIn.length > 0
                        ? item.seenIn.map((angle) => ANGLE_LABEL[angle]).join(', ')
                        : 'posição não informada'}
                    </span>
                  </>
                ) : (
                  <span className="text-muted-foreground">A leitura não trouxe este segmento.</span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </Block>
  );
}

function Highlights({ assessment }: { assessment: PhotoAssessmentAudit }) {
  const physique = assessment.physique;
  return (
    <Block title="Simetria e destaques">
      <dl className="space-y-3">
        {physique ? (
          <>
            <div>
              <dt className="text-xs font-medium text-muted-foreground">Simetria</dt>
              <dd className="mt-0.5 text-label">
                {physique.symmetry ?? 'As fotos não permitiram comparar os lados.'}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-muted-foreground">Pontos fortes</dt>
              <dd className="mt-0.5">
                <TextList items={physique.strengths} empty="Nenhum destacado na leitura." />
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-muted-foreground">Pontos de atenção</dt>
              <dd className="mt-0.5">
                <TextList items={physique.attentionPoints} empty="Nenhum destacado na leitura." />
              </dd>
            </div>
          </>
        ) : null}
        <div>
          <dt className="text-xs font-medium text-muted-foreground">
            Observações para a auditoria
          </dt>
          <dd className="mt-0.5">
            <TextList
              items={assessment.observationsForProfessional}
              empty="Nenhuma observação registrada."
            />
          </dd>
        </div>
      </dl>
    </Block>
  );
}

function AssessmentReading({
  assessment,
  previous,
}: {
  assessment: PhotoAssessmentAudit;
  previous: PhotoAssessmentAudit | null;
}) {
  return (
    <div className="space-y-4">
      <Header assessment={assessment} />
      {assessment.physique ? null : (
        <p className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
          Avaliação feita antes da avaliação física completa: mostra só a gordura corporal, as
          observações e as limitações. Grupos musculares e postura não fazem parte desta leitura.
        </p>
      )}
      <BodyFat assessment={assessment} previous={previous} />
      {assessment.physique ? (
        <>
          <MuscleMap groups={assessment.physique.muscleGroups} />
          <Posture items={assessment.physique.posture} />
        </>
      ) : null}
      <Highlights assessment={assessment} />
      <Block title="Limitações da leitura">
        <TextList items={assessment.limitations} empty="Nenhuma limitação registrada." />
      </Block>
      <p className="flex gap-2 border-t border-border pt-4 text-xs text-muted-foreground">
        <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
        <span>
          Percepção por foto: descreve o que aparece nas imagens e não é laudo nem avaliação
          clínica. Quando a leitura aponta alteração marcante, o aluno é avisado com a recomendação
          de procurar uma avaliação profissional externa.
        </span>
      </p>
    </div>
  );
}

export const PHOTO_ASSESSMENT_EMPTY = 'O aluno não enviou fotos ou não autorizou o uso.';

/**
 * Conteúdo da seção. `assessments` ausente (servidor antigo) ou sem leitura cai no estado vazio;
 * `loading` e `error` existem para quando a leitura vier por conta própria.
 */
export function PhysiqueAssessmentCard({
  assessments,
  loading = false,
  error = null,
  onRetry,
}: {
  assessments?: StudentPhotoAssessments | null;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}) {
  const [showPrevious, setShowPrevious] = useState(false);

  if (loading) {
    return (
      <div aria-busy="true" className="space-y-3">
        <span className="sr-only">Carregando a avaliação física por foto.</span>
        {[0, 1, 2].map((key) => (
          <div
            key={key}
            aria-hidden="true"
            className="h-12 animate-pulse rounded-lg bg-muted motion-reduce:animate-none"
          />
        ))}
      </div>
    );
  }
  if (error) {
    return (
      <div role="alert" className="space-y-2">
        <p className="text-label">Não foi possível carregar a avaliação física por foto.</p>
        <p className="text-xs text-muted-foreground">{error}</p>
        {onRetry ? (
          <Button type="button" variant="outline" onClick={onRetry}>
            Tentar de novo
          </Button>
        ) : null}
      </div>
    );
  }

  const latest = assessments?.latest ?? null;
  if (!latest) return <p className="text-xs text-muted-foreground">{PHOTO_ASSESSMENT_EMPTY}</p>;

  const previous = assessments?.previous ?? null;
  const current = showPrevious && previous ? previous : latest;

  return (
    <div className="space-y-4">
      {previous ? (
        <div role="group" aria-label="Escolher a avaliação" className="flex flex-wrap gap-2">
          {[
            { value: false, item: latest, suffix: 'mais recente' },
            { value: true, item: previous, suffix: 'anterior' },
          ].map(({ value, item, suffix }) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={showPrevious === value}
              onClick={() => setShowPrevious(value)}
              className={cn(
                'inline-flex h-11 items-center rounded-md border px-3 text-label lg:h-10',
                showPrevious === value
                  ? 'border-foreground bg-secondary font-semibold text-secondary-foreground'
                  : 'border-input bg-card text-foreground',
                FOCUS_RING,
              )}
            >
              {formatAssessedOn(item.assessedOn)} ({suffix})
            </button>
          ))}
        </div>
      ) : null}
      <AssessmentReading
        key={current.id}
        assessment={current}
        previous={current === latest ? previous : null}
      />
    </div>
  );
}
