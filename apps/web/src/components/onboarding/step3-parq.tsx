'use client';

import * as React from 'react';

import {
  PARQ_DECLARATIONS,
  PARQ_QUESTION_IDS,
  PARQ_QUESTION_TEXT,
  type ParqQuestionId,
} from '@movivo/shared';

import { Checkbox, FieldLabel, QuestionField, QuestionStack, TextArea, YesNo } from './fields';

export interface ParqAnswerState {
  answer: boolean | undefined;
  detail: string;
}

export type ParqState = Record<ParqQuestionId, ParqAnswerState>;

export const EMPTY_PARQ: ParqState = Object.fromEntries(
  PARQ_QUESTION_IDS.map((id) => [id, { answer: undefined, detail: '' }]),
) as ParqState;

export function Step3Parq({
  answers,
  onChange,
  declarations,
  onToggleDeclaration,
  onSubmit,
  onBack,
  initialScreen = -1,
  onScreenChange,
  submitting,
}: {
  answers: ParqState;
  onChange: (id: ParqQuestionId, value: ParqAnswerState) => void;
  declarations: Set<string>;
  onToggleDeclaration: (id: string, checked: boolean) => void;
  onSubmit: () => void;
  onBack?: () => void;
  /** -1 = abertura, 0..8 = perguntas, 9 = confirmações. */
  initialScreen?: number;
  onScreenChange?: (screen: number) => void;
  submitting: boolean;
}) {
  const [screen, setScreen] = React.useState(Math.min(9, Math.max(-1, initialScreen)));
  const titleRef = React.useRef<HTMLHeadingElement>(null);
  const questionId =
    screen >= 0 && screen < PARQ_QUESTION_IDS.length ? PARQ_QUESTION_IDS[screen] : undefined;
  const currentAnswer = questionId ? answers[questionId] : undefined;
  const allDeclared = PARQ_DECLARATIONS.every((declaration) => declarations.has(declaration.id));

  React.useEffect(() => {
    titleRef.current?.focus();
  }, [screen]);

  function navigate(next: number) {
    const bounded = Math.min(9, Math.max(-1, next));
    setScreen(bounded);
    onScreenChange?.(bounded);
  }

  const questionComplete =
    currentAnswer?.answer !== undefined &&
    !(questionId === 'Q9' && currentAnswer.answer && currentAnswer.detail.trim().length === 0);

  return (
    <div className="flex flex-col gap-6 pb-4">
      {screen === -1 && (
        <section className="flex flex-col gap-6" aria-labelledby="parq-title">
          <div className="flex flex-col gap-2">
            <p className="font-mono text-label text-muted-foreground">Etapa 3 de 3</p>
            <h1
              ref={titleRef}
              id="parq-title"
              tabIndex={-1}
              className="text-h1 font-bold text-petroleo outline-none"
            >
              Última parte: sua segurança
            </h1>
          </div>
          <p className="text-body text-muted-foreground">
            São 9 perguntas rápidas, de sim ou não. É o questionário que o profissional de Educação
            Física usa antes de preparar um treino.
          </p>
          <p className="rounded-xl border border-coral bg-coral/10 p-4 text-body text-petroleo">
            Se alguma resposta for “sim”, tudo bem. O profissional responsável só vai olhar seu caso
            antes de o treino ser preparado.
          </p>
        </section>
      )}

      {questionId && currentAnswer && (
        <section className="flex flex-col gap-6" aria-labelledby="parq-title">
          <div className="flex flex-col gap-2">
            <p className="font-mono text-label text-muted-foreground">
              Pergunta {screen + 1} de {PARQ_QUESTION_IDS.length}
            </p>
            <h1
              ref={titleRef}
              id="parq-title"
              tabIndex={-1}
              className="text-body font-semibold text-foreground outline-none"
            >
              {PARQ_QUESTION_TEXT[questionId]}
            </h1>
          </div>
          <YesNo
            legend="Selecione uma resposta"
            value={currentAnswer.answer}
            onChange={(answer) => onChange(questionId, { ...currentAnswer, answer })}
            indicatorSide="left"
          />
          {currentAnswer.answer === true && (
            <QuestionStack aria-live="polite">
              <p className="text-body text-muted-foreground">Anotado. Obrigado por contar.</p>
              <QuestionField className="border-l-2 border-primary pl-4">
                <FieldLabel htmlFor={`detail-${questionId}`}>
                  {questionId === 'Q9'
                    ? 'Qual motivo? (obrigatório)'
                    : 'Quer contar um pouco mais? (opcional)'}
                </FieldLabel>
                <TextArea
                  id={`detail-${questionId}`}
                  value={currentAnswer.detail}
                  onChange={(detail) => onChange(questionId, { ...currentAnswer, detail })}
                />
              </QuestionField>
            </QuestionStack>
          )}
        </section>
      )}

      {screen === 9 && (
        <section className="flex flex-col gap-6" aria-labelledby="parq-title">
          <div className="flex flex-col gap-2">
            <p className="font-mono text-label text-muted-foreground">Confirmações finais</p>
            <h1
              ref={titleRef}
              id="parq-title"
              tabIndex={-1}
              className="text-h1 font-bold text-petroleo outline-none"
            >
              Só falta confirmar
            </h1>
            <p className="text-body text-muted-foreground">
              Leia com atenção antes de enviar suas respostas.
            </p>
          </div>
          <div className="flex flex-col gap-3">
            {PARQ_DECLARATIONS.map((declaration) => (
              <Checkbox
                key={declaration.id}
                id={`declaration-${declaration.id}`}
                checked={declarations.has(declaration.id)}
                onChange={(checked) => onToggleDeclaration(declaration.id, checked)}
                required
              >
                {declaration.label}
              </Checkbox>
            ))}
          </div>
        </section>
      )}

      <div className="sticky bottom-0 z-10 -mx-5 mt-1 flex flex-col-reverse gap-3 border-t border-border bg-white/95 px-5 py-4 backdrop-blur-sm sm:static sm:mx-0 sm:flex-row sm:border-0 sm:bg-transparent sm:px-0 sm:py-0 sm:backdrop-blur-none">
        {(screen >= 0 || onBack) && (
          <button
            type="button"
            onClick={() => (screen === -1 ? onBack?.() : navigate(screen - 1))}
            disabled={submitting}
            className="h-[52px] flex-1 rounded-xl border border-input bg-white px-6 text-body font-semibold text-petroleo transition-colors hover:bg-secondary disabled:opacity-50"
          >
            Voltar
          </button>
        )}
        {screen < 9 ? (
          <button
            type="button"
            disabled={(screen >= 0 && !questionComplete) || submitting}
            onClick={() => navigate(screen + 1)}
            className="h-[52px] flex-1 rounded-xl bg-primary px-6 text-body font-semibold text-primary-foreground transition-colors hover:bg-primary/85 disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground"
          >
            {screen === -1 ? 'Começar' : 'Continuar'}
          </button>
        ) : (
          <button
            type="button"
            disabled={!allDeclared || submitting}
            onClick={onSubmit}
            className="h-[52px] flex-1 rounded-xl bg-primary px-6 text-body font-semibold text-primary-foreground transition-colors hover:bg-primary/85 disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground"
          >
            {submitting ? 'Guardando suas respostas…' : 'Finalizar avaliação'}
          </button>
        )}
      </div>
    </div>
  );
}
