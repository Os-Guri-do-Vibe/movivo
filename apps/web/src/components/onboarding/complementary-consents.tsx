'use client';

import * as React from 'react';

import type { ConsentItemView } from '@/lib/anamnesis-api';

import { Checkbox, QuestionStack } from './fields';
import { ConsentLabel } from './step1-registration';

/**
 * Primeira tela da anamnese complementar: quem já era aluno aceitou textos anteriores, e a
 * versão atual do serviço descreve plano de treino e de alimentação, vários profissionais e IA
 * dentro de regras publicadas. Um aceite de texto antigo não prova consentimento ao texto novo,
 * então os obrigatórios são aceitos de novo, com o corpo completo à vista.
 */
export function ComplementaryConsents({
  consents,
  saving,
  onAccept,
}: {
  consents: ConsentItemView[];
  saving: boolean;
  onAccept: (accepted: ConsentItemView[]) => void;
}) {
  const [accepted, setAccepted] = React.useState<Set<string>>(new Set());
  const titleRef = React.useRef<HTMLHeadingElement>(null);
  React.useEffect(() => titleRef.current?.focus(), []);

  const allRequired = consents.filter((c) => c.required).every((c) => accepted.has(c.type));

  return (
    <QuestionStack>
      <div>
        <h1 ref={titleRef} tabIndex={-1} className="text-h2 font-bold outline-none">
          Antes de continuar
        </h1>
        <p className="mt-2 text-body text-muted-foreground">
          A MOVIVO agora monta plano de treino e de alimentação, com profissionais de mais de uma
          área. Leia e confirme os textos atualizados para seguir.
        </p>
      </div>

      {consents
        .filter((consent) => consent.body.length > 0)
        .map((consent) => (
          <section key={consent.type} className="flex flex-col gap-2">
            {consent.title && <h2 className="text-body font-semibold">{consent.title}</h2>}
            {consent.body.map((paragraph) => (
              <p key={paragraph.slice(0, 32)} className="text-label text-muted-foreground">
                {paragraph.replaceAll('**', '')}
              </p>
            ))}
          </section>
        ))}

      <div className="flex flex-col gap-4">
        {consents.map((consent) => (
          <Checkbox
            key={consent.type}
            id={`consent-${consent.type}`}
            checked={accepted.has(consent.type)}
            onChange={(checked) =>
              setAccepted((prev) => {
                const next = new Set(prev);
                if (checked) next.add(consent.type);
                else next.delete(consent.type);
                return next;
              })
            }
            required={consent.required}
          >
            <ConsentLabel consent={consent} />
          </Checkbox>
        ))}
      </div>

      <div className="sticky bottom-0 z-10 -mx-5 mt-1 border-t border-border bg-white/95 px-5 py-4 backdrop-blur-sm sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:py-0 sm:backdrop-blur-none">
        <button
          type="button"
          disabled={!allRequired || saving}
          onClick={() => onAccept(consents.filter((c) => accepted.has(c.type)))}
          className="h-[52px] w-full rounded-xl bg-primary px-6 text-body font-semibold text-primary-foreground transition-colors hover:bg-primary/85 disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground"
        >
          {saving ? 'Salvando…' : 'Continuar'}
        </button>
      </div>
    </QuestionStack>
  );
}
