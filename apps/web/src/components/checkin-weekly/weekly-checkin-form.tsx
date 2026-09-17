'use client';

import * as React from 'react';

import type {
  CheckinWeeklyChange,
  CheckinWeeklyDurationFit,
  CheckinWeeklyMood,
  CheckinWeeklySubmit,
  RenewalSleepQuality,
} from '@movivo/shared';

import { ChoiceGroup, FieldLabel, QuestionField, TextArea } from '@/components/onboarding/fields';
import { BlockFooter, QuestionHeader } from '@/components/protocol-renewal/block-shell';

/** Estado local do formulário — mesmas opções/labels da pergunta de sono da renovação de mesociclo. */
export interface WeeklyCheckinState {
  sleepQuality: RenewalSleepQuality | null;
  mood: CheckinWeeklyMood | null;
  nutritionScore: number;
  adherenceScore: number;
  difficultExerciseDescription: string;
  changesNoticed: CheckinWeeklyChange[];
  changesOther: string;
  durationFit: CheckinWeeklyDurationFit | null;
  improvementFeedback: string;
}

export const EMPTY_WEEKLY_CHECKIN: WeeklyCheckinState = {
  sleepQuality: null,
  mood: null,
  nutritionScore: 5,
  adherenceScore: 5,
  difficultExerciseDescription: '',
  changesNoticed: [],
  changesOther: '',
  durationFit: null,
  improvementFeedback: '',
};

const SLEEP_QUALITY_ITEMS: { value: RenewalSleepQuality; label: string }[] = [
  { value: 'OTIMA', label: 'Ótima: 8 horas ou mais por noite' },
  { value: 'BOA', label: 'Boa: cerca de 7 horas por noite' },
  { value: 'REGULAR', label: 'Regular: cerca de 6 horas por noite' },
  { value: 'RUIM', label: 'Ruim: 5 horas ou menos por noite' },
];

const MOOD_ITEMS: { value: CheckinWeeklyMood; label: string }[] = [
  { value: 'MUITO_FELIZ', label: 'Extremamente feliz' },
  { value: 'FELIZ', label: 'Feliz' },
  { value: 'NEUTRO', label: 'Neutro' },
  { value: 'TRISTE', label: 'Triste' },
  { value: 'DESMOTIVADO', label: 'Desmotivado(a) / estressado(a)' },
  { value: 'PREFIRO_NAO_RESPONDER', label: 'Prefiro não responder' },
];

const CHANGE_ITEMS: { value: CheckinWeeklyChange; label: string }[] = [
  { value: 'FORCA', label: 'Aumento de força' },
  { value: 'RESISTENCIA', label: 'Aumento da resistência' },
  { value: 'MASSA_MUSCULAR', label: 'Ganho de massa muscular' },
  { value: 'QUALIDADE_SONO', label: 'Melhora na qualidade do sono' },
  { value: 'TECNICA', label: 'Melhora na técnica dos movimentos' },
  { value: 'BEM_ESTAR_MENTAL', label: 'Melhora no bem-estar mental' },
  { value: 'OUTRAS', label: 'Outras' },
];

const DURATION_FIT_ITEMS: { value: CheckinWeeklyDurationFit; label: string }[] = [
  { value: 'ADEQUADA', label: 'Sim, está adequada' },
  { value: 'MAIS_CURTOS', label: 'Poderiam ser um pouco mais curtos' },
  { value: 'MAIS_LONGOS', label: 'Poderiam ser um pouco mais longos' },
];

const TOTAL_QUESTIONS = 8;

function toSubmitPayload(data: WeeklyCheckinState): CheckinWeeklySubmit | null {
  if (!data.sleepQuality || !data.mood || !data.durationFit) return null;
  return {
    sleepQuality: data.sleepQuality,
    mood: data.mood,
    nutritionScore: data.nutritionScore,
    adherenceScore: data.adherenceScore,
    difficultExerciseDescription: data.difficultExerciseDescription.trim() || undefined,
    changesNoticed: data.changesNoticed,
    changesOther: data.changesOther.trim() || undefined,
    durationFit: data.durationFit,
    improvementFeedback: data.improvementFeedback.trim() || undefined,
  };
}

export function WeeklyCheckinForm({
  onSubmit,
  saving,
}: {
  onSubmit: (payload: CheckinWeeklySubmit) => void;
  saving: boolean;
}) {
  const [data, setData] = React.useState<WeeklyCheckinState>(EMPTY_WEEKLY_CHECKIN);
  const [screen, setScreen] = React.useState(0);
  const titleRef = React.useRef<HTMLHeadingElement>(null);

  React.useEffect(() => {
    titleRef.current?.focus();
  }, [screen]);

  function navigate(next: number) {
    setScreen(Math.min(TOTAL_QUESTIONS - 1, Math.max(0, next)));
  }

  function set<K extends keyof WeeklyCheckinState>(key: K, value: WeeklyCheckinState[K]) {
    setData((prev) => ({ ...prev, [key]: value }));
  }

  function toggleChange(value: CheckinWeeklyChange) {
    set(
      'changesNoticed',
      data.changesNoticed.includes(value)
        ? data.changesNoticed.filter((v) => v !== value)
        : [...data.changesNoticed, value],
    );
  }

  function hasText(value: string): boolean {
    return value.trim().length > 0;
  }

  const changesComplete = !data.changesNoticed.includes('OUTRAS') || hasText(data.changesOther);
  const screenComplete = [
    data.sleepQuality !== null,
    data.mood !== null,
    true,
    true,
    true,
    changesComplete,
    data.durationFit !== null,
    true,
  ][screen];

  function handleContinue() {
    if (screen < TOTAL_QUESTIONS - 1) {
      navigate(screen + 1);
      return;
    }
    const payload = toSubmitPayload(data);
    if (payload) onSubmit(payload);
  }

  return (
    <div className="flex flex-col gap-6 pb-4">
      {screen === 0 && (
        <section className="flex flex-col gap-6" aria-labelledby="checkin-title">
          <QuestionHeader
            index={1}
            total={TOTAL_QUESTIONS}
            titleId="checkin-title"
            titleRef={titleRef}
          >
            Durante esta última semana, como foi a duração do seu sono?
          </QuestionHeader>
          <ChoiceGroup<RenewalSleepQuality>
            legend="Selecione uma resposta"
            items={SLEEP_QUALITY_ITEMS}
            selected={data.sleepQuality ? [data.sleepQuality] : []}
            onToggle={(value) => set('sleepQuality', value)}
            stack
            indicatorSide="left"
          />
        </section>
      )}

      {screen === 1 && (
        <section className="flex flex-col gap-6" aria-labelledby="checkin-title">
          <QuestionHeader
            index={2}
            total={TOTAL_QUESTIONS}
            titleId="checkin-title"
            titleRef={titleRef}
          >
            Como você descreveria o seu humor durante esta última semana?
          </QuestionHeader>
          <ChoiceGroup<CheckinWeeklyMood>
            legend="Selecione uma resposta"
            items={MOOD_ITEMS}
            selected={data.mood ? [data.mood] : []}
            onToggle={(value) => set('mood', value)}
            stack
            indicatorSide="left"
          />
        </section>
      )}

      {screen === 2 && (
        <section className="flex flex-col gap-6" aria-labelledby="checkin-title">
          <QuestionHeader
            index={3}
            total={TOTAL_QUESTIONS}
            titleId="checkin-title"
            titleRef={titleRef}
          >
            Em uma escala de 0 a 10, como você avaliaria a sua alimentação nesta última semana?
          </QuestionHeader>
          <QuestionField className="rounded-xl border border-border bg-secondary p-4">
            <FieldLabel htmlFor="nutritionScore">Alimentação nesta última semana</FieldLabel>
            <input
              id="nutritionScore"
              type="range"
              min={0}
              max={10}
              step={1}
              value={data.nutritionScore}
              onChange={(e) => set('nutritionScore', Number(e.target.value))}
              aria-valuetext={`${data.nutritionScore} de 10`}
              className="h-2 w-full accent-primary"
            />
            <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-3 text-label text-muted-foreground">
              <span>0 · Muito ruim</span>
              <span className="font-mono text-h3 font-semibold text-foreground" aria-hidden="true">
                {data.nutritionScore}
              </span>
              <span className="text-right">10 · Excelente</span>
            </div>
          </QuestionField>
        </section>
      )}

      {screen === 3 && (
        <section className="flex flex-col gap-6" aria-labelledby="checkin-title">
          <QuestionHeader
            index={4}
            total={TOTAL_QUESTIONS}
            titleId="checkin-title"
            titleRef={titleRef}
          >
            Em uma escala de 0 a 10, quanto você conseguiu seguir o seu protocolo individual de
            treino nesta última semana?
          </QuestionHeader>
          <QuestionField className="rounded-xl border border-border bg-secondary p-4">
            <FieldLabel htmlFor="adherenceScore">Aderência ao protocolo de treino</FieldLabel>
            <input
              id="adherenceScore"
              type="range"
              min={0}
              max={10}
              step={1}
              value={data.adherenceScore}
              onChange={(e) => set('adherenceScore', Number(e.target.value))}
              aria-valuetext={`${data.adherenceScore} de 10`}
              className="h-2 w-full accent-primary"
            />
            <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-3 text-label text-muted-foreground">
              <span>0 · Nenhum treino planejado</span>
              <span className="font-mono text-h3 font-semibold text-foreground" aria-hidden="true">
                {data.adherenceScore}
              </span>
              <span className="text-right">10 · Todos os treinos</span>
            </div>
          </QuestionField>
        </section>
      )}

      {screen === 4 && (
        <section className="flex flex-col gap-6" aria-labelledby="checkin-title">
          <QuestionHeader
            index={5}
            total={TOTAL_QUESTIONS}
            titleId="checkin-title"
            titleRef={titleRef}
          >
            Em relação aos seus treinos desta última semana, houve algum exercício que você não
            conseguiu realizar ou que não se sentiu confortável em executar?
          </QuestionHeader>
          <QuestionField>
            <FieldLabel htmlFor="difficultExerciseDescription">
              Se sim, conte para a gente qual exercício e o motivo
            </FieldLabel>
            <TextArea
              id="difficultExerciseDescription"
              value={data.difficultExerciseDescription}
              onChange={(value) => set('difficultExerciseDescription', value)}
              maxLength={2000}
            />
          </QuestionField>
        </section>
      )}

      {screen === 5 && (
        <section className="flex flex-col gap-6" aria-labelledby="checkin-title">
          <QuestionHeader
            index={6}
            total={TOTAL_QUESTIONS}
            titleId="checkin-title"
            titleRef={titleRef}
          >
            Você percebeu alguma mudança ou evolução nesta última semana?
          </QuestionHeader>
          <ChoiceGroup<CheckinWeeklyChange>
            legend="Selecione todas as opções que se aplicam"
            items={CHANGE_ITEMS}
            selected={data.changesNoticed}
            onToggle={toggleChange}
            multi
            stack
            indicatorSide="left"
          />
          {data.changesNoticed.includes('OUTRAS') && (
            <QuestionField className="border-l-2 border-primary pl-4" aria-live="polite">
              <FieldLabel htmlFor="changesOther">
                Conte para a gente quais mudanças você percebeu
              </FieldLabel>
              <TextArea
                id="changesOther"
                value={data.changesOther}
                onChange={(value) => set('changesOther', value)}
                maxLength={300}
              />
            </QuestionField>
          )}
        </section>
      )}

      {screen === 6 && (
        <section className="flex flex-col gap-6" aria-labelledby="checkin-title">
          <QuestionHeader
            index={7}
            total={TOTAL_QUESTIONS}
            titleId="checkin-title"
            titleRef={titleRef}
          >
            A duração dos seus treinos está adequada à sua rotina?
          </QuestionHeader>
          <ChoiceGroup<CheckinWeeklyDurationFit>
            legend="Selecione uma resposta"
            items={DURATION_FIT_ITEMS}
            selected={data.durationFit ? [data.durationFit] : []}
            onToggle={(value) => set('durationFit', value)}
            stack
            indicatorSide="left"
          />
        </section>
      )}

      {screen === 7 && (
        <section className="flex flex-col gap-6" aria-labelledby="checkin-title">
          <QuestionHeader
            index={8}
            total={TOTAL_QUESTIONS}
            titleId="checkin-title"
            titleRef={titleRef}
          >
            Existe algum aspecto do seu acompanhamento que você acredita que poderia ser aprimorado
            para atender ainda melhor às suas necessidades?
          </QuestionHeader>
          <QuestionField>
            <FieldLabel htmlFor="improvementFeedback">
              Esta pergunta é opcional. Seu feedback nos ajuda a tornar seu acompanhamento cada vez
              mais personalizado.
            </FieldLabel>
            <TextArea
              id="improvementFeedback"
              value={data.improvementFeedback}
              onChange={(value) => set('improvementFeedback', value)}
              maxLength={2000}
            />
          </QuestionField>
        </section>
      )}

      <BlockFooter
        onBack={screen > 0 ? () => navigate(screen - 1) : undefined}
        onContinue={handleContinue}
        continueLabel={screen === TOTAL_QUESTIONS - 1 ? 'Enviar' : 'Continuar'}
        savingLabel="Enviando…"
        disabled={!screenComplete}
        saving={saving}
      />
    </div>
  );
}
