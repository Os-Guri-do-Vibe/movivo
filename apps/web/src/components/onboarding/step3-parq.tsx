'use client';

import {
  PARQ_DECLARATIONS,
  PARQ_QUESTION_IDS,
  PARQ_QUESTION_TEXT,
  type ParqQuestionId,
} from '@movivo/shared';

import { Checkbox, FieldLabel, TextArea, YesNo } from './fields';

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
  submitting,
}: {
  answers: ParqState;
  onChange: (id: ParqQuestionId, value: ParqAnswerState) => void;
  declarations: Set<string>;
  onToggleDeclaration: (id: string, checked: boolean) => void;
  onSubmit: () => void;
  submitting: boolean;
}) {
  const allAnswered = PARQ_QUESTION_IDS.every((id) => answers[id].answer !== undefined);
  const q9 = answers.Q9;
  const q9Ok = q9.answer !== true || q9.detail.trim().length > 0;
  const allDeclared = PARQ_DECLARATIONS.every((d) => declarations.has(d.id));
  const canSubmit = allAnswered && q9Ok && allDeclared && !submitting;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <p className="font-mono text-label text-muted-foreground">Etapa 3 de 3</p>
        <h1 className="text-h1 font-bold">Avaliação de segurança</h1>
        <p className="mt-2 text-body text-muted-foreground">
          Antes de preparar seu treino, precisamos verificar se existe alguma condição que exija
          atenção do profissional responsável. Responda considerando sua condição de saúde atual.
        </p>
      </div>

      <div className="flex flex-col gap-6">
        {PARQ_QUESTION_IDS.map((id) => (
          <div key={id} className="flex flex-col gap-3 rounded-lg border border-input p-4">
            <YesNo
              legend={PARQ_QUESTION_TEXT[id]}
              value={answers[id].answer}
              onChange={(answer) => onChange(id, { ...answers[id], answer })}
            />
            {answers[id].answer === true && (
              <div className="flex flex-col gap-2">
                <FieldLabel htmlFor={`detail-${id}`}>
                  {id === 'Q9' ? 'Qual motivo? (obrigatório)' : 'Conta um pouco mais? (opcional)'}
                </FieldLabel>
                <TextArea
                  id={`detail-${id}`}
                  value={answers[id].detail}
                  onChange={(detail) => onChange(id, { ...answers[id], detail })}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-4">
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

      <button
        type="button"
        disabled={!canSubmit}
        onClick={onSubmit}
        className="h-11 rounded-lg bg-primary px-6 text-body font-semibold text-primary-foreground shadow-xs transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
      >
        {submitting ? 'Enviando…' : 'FINALIZAR AVALIAÇÃO'}
      </button>
    </div>
  );
}
