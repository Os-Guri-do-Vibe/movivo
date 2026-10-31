'use client';

import { painComplete } from './onboarding-drafts';
import { PainSection, type PainData } from './pain-section';
import { StepFrame } from './step-frame';

/** Dores e limitações: tela própria, só com esta pergunta (e o que ela abre). */
export function StepPain({
  data,
  onChange,
  onContinue,
  onBack,
  saving,
  resumed,
}: {
  data: PainData;
  onChange: (data: PainData) => void;
  onContinue: () => void;
  onBack?: () => void;
  saving: boolean;
  resumed: boolean;
}) {
  return (
    <StepFrame
      title="Dores e limitações"
      description="Isso é o que mantém o seu treino seguro."
      notice={
        resumed
          ? 'Suas respostas de saúde ficam guardadas em sigilo e não são exibidas de novo. Se voltar aqui, responda outra vez para atualizar.'
          : undefined
      }
      canContinue={painComplete(data)}
      saving={saving}
      onContinue={onContinue}
      onBack={onBack}
    >
      <PainSection data={data} onChange={onChange} />
    </StepFrame>
  );
}
