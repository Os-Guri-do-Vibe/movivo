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
      description="Saber onde incomoda ajuda a adaptar exercícios e cargas desde o primeiro treino. Se não sentir nada, é só responder “Não”."
      notice={
        resumed
          ? 'Por sigilo, suas respostas de saúde não aparecem de novo. Responda outra vez para continuar.'
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
