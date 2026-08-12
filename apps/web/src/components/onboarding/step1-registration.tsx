'use client';

import * as React from 'react';

import {
  ageInYears,
  MIN_AGE_YEARS,
  UNDER_AGE_MESSAGE,
  WHATSAPP_OPERATIONAL_NOTICE,
  type BiologicalSex,
} from '@movivo/shared';

import {
  isPhoneComplete,
  toE164,
  type ConsentItemView,
  type PhoneCountryIso,
} from '@/lib/anamnesis-api';
import {
  Checkbox,
  ChoiceGroup,
  FieldError,
  FieldHelp,
  FieldLabel,
  QuestionField,
  QuestionStack,
  TextInput,
} from './fields';
import { DatePicker } from './date-picker';
import { PhoneInput } from './phone-input';
import { PhoneOtp } from './phone-otp';

export interface Step1Data {
  name: string;
  birthDate: string;
  biologicalSex: BiologicalSex | null;
  phoneCountryIso: PhoneCountryIso;
  phoneMasked: string;
  email: string;
}

export function Step1Registration({
  data,
  onChange,
  consents,
  acceptedConsents,
  onToggleConsent,
  phoneVerified,
  onPhoneVerified,
  token,
  onContinue,
  saving,
}: {
  data: Step1Data;
  onChange: (data: Step1Data) => void;
  consents: ConsentItemView[];
  acceptedConsents: Set<string>;
  onToggleConsent: (type: string, checked: boolean) => void;
  phoneVerified: boolean;
  onPhoneVerified: () => void;
  token: string;
  onContinue: () => void;
  saving: boolean;
}) {
  const age = data.birthDate ? ageInYears(data.birthDate) : null;
  const underAge = age !== null && age < MIN_AGE_YEARS;
  const phoneComplete = isPhoneComplete(data.phoneCountryIso, data.phoneMasked);
  const phoneE164 = toE164(data.phoneCountryIso, data.phoneMasked);
  const requiredConsents = consents.filter((c) => c.required);
  const allRequiredAccepted = requiredConsents.every((c) => acceptedConsents.has(c.type));

  const canContinue =
    data.name.trim().length >= 2 &&
    data.birthDate.length === 10 &&
    !underAge &&
    data.biologicalSex !== null &&
    phoneVerified &&
    allRequiredAccepted &&
    !saving;

  return (
    <QuestionStack className="pb-4">
      <div>
        <h1 className="text-h1 font-bold text-petroleo">Vamos começar por você</h1>
        <p className="mt-2 text-body text-muted-foreground">
          É rápido. Estas informações ajudam o profissional responsável a preparar um treino que
          faça sentido para a sua rotina.
        </p>
      </div>

      <QuestionField>
        <FieldLabel htmlFor="name">Qual é o seu nome completo?</FieldLabel>
        <TextInput
          id="name"
          value={data.name}
          onChange={(name) => onChange({ ...data, name })}
          autoComplete="name"
        />
      </QuestionField>

      <QuestionField>
        <FieldLabel htmlFor="birthDate">Qual é a sua data de nascimento?</FieldLabel>
        <DatePicker
          id="birthDate"
          value={data.birthDate}
          onChange={(birthDate) => onChange({ ...data, birthDate })}
          error={underAge}
          autoComplete="bday"
        />
        <FieldError message={underAge ? UNDER_AGE_MESSAGE : undefined} />
      </QuestionField>

      <ChoiceGroup<BiologicalSex>
        legend="Qual é o seu sexo biológico?"
        items={[
          { value: 'FEMALE', label: 'Feminino' },
          { value: 'MALE', label: 'Masculino' },
        ]}
        selected={data.biologicalSex ? [data.biologicalSex] : []}
        onToggle={(biologicalSex) => onChange({ ...data, biologicalSex })}
        indicatorSide="left"
      />

      <QuestionField>
        <FieldLabel htmlFor="phone">Qual é o seu WhatsApp?</FieldLabel>
        <FieldHelp>Enviaremos seu treino e faremos seu acompanhamento por este número.</FieldHelp>
        <PhoneInput
          id="phone"
          countryIso={data.phoneCountryIso}
          value={data.phoneMasked}
          onChange={(phoneMasked) => onChange({ ...data, phoneMasked })}
          onCountryChange={(phoneCountryIso, phoneMasked) =>
            onChange({ ...data, phoneCountryIso, phoneMasked })
          }
        />
        {phoneComplete && !phoneVerified && (
          <PhoneOtp token={token} phoneNumber={phoneE164} onVerified={onPhoneVerified} />
        )}
        {phoneVerified && (
          <p className="text-label font-semibold text-petroleo">✓ WhatsApp confirmado</p>
        )}
      </QuestionField>

      <QuestionField>
        <FieldLabel htmlFor="email">Qual é o seu e-mail? (opcional)</FieldLabel>
        <TextInput
          id="email"
          type="email"
          autoComplete="email"
          value={data.email}
          onChange={(email) => onChange({ ...data, email })}
        />
      </QuestionField>

      <div className="flex flex-col gap-3 rounded-xl border border-coral bg-coral/10 p-4">
        <p className="text-body font-semibold">{WHATSAPP_OPERATIONAL_NOTICE.title}</p>
        {WHATSAPP_OPERATIONAL_NOTICE.body.map((paragraph) => (
          <p key={paragraph.slice(0, 24)} className="text-label text-muted-foreground">
            {paragraph}
          </p>
        ))}
      </div>

      <div className="flex flex-col gap-4">
        {consents.map((consent) => (
          <Checkbox
            key={consent.type}
            id={`consent-${consent.type}`}
            checked={acceptedConsents.has(consent.type)}
            onChange={(checked) => onToggleConsent(consent.type, checked)}
            required={consent.required}
          >
            <ConsentLabel consent={consent} />
          </Checkbox>
        ))}
      </div>

      <div className="sticky bottom-0 z-10 -mx-5 mt-1 border-t border-border bg-white/95 px-5 py-4 backdrop-blur-sm sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:py-0 sm:backdrop-blur-none">
        <button
          type="button"
          disabled={!canContinue}
          onClick={onContinue}
          className="h-[52px] w-full rounded-xl bg-primary px-6 text-body font-semibold text-primary-foreground transition-colors hover:bg-primary/85 disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground"
        >
          {saving ? 'Salvando…' : 'Continuar'}
        </button>
      </div>
    </QuestionStack>
  );
}

/** Renderiza o `label` do consentimento com o link de Termos, sem alterar o texto do backend. */
function ConsentLabel({ consent }: { consent: ConsentItemView }) {
  const parts = consent.label.split(/(\[[^\]]+\]\([^)]+\))/g);
  return (
    <>
      {parts.map((part, i) => {
        const match = /\[([^\]]+)\]\(([^)]+)\)/.exec(part);
        if (!match) return <React.Fragment key={i}>{part}</React.Fragment>;
        return (
          <a key={i} href={match[2]} target="_blank" rel="noreferrer" className="underline">
            {match[1]}
          </a>
        );
      })}
    </>
  );
}
