'use client';

import * as React from 'react';

import {
  ageInYears,
  MIN_AGE_YEARS,
  UNDER_AGE_MESSAGE,
  WHATSAPP_OPERATIONAL_NOTICE,
  type BiologicalSex,
} from '@movivo/shared';

import { maskPhoneBR, toE164BR, type ConsentItemView } from '@/lib/anamnesis-api';
import { Checkbox, ChoiceGroup, FieldError, FieldLabel, TextInput } from './fields';
import { PhoneOtp } from './phone-otp';

export interface Step1Data {
  name: string;
  birthDate: string;
  biologicalSex: BiologicalSex | null;
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
  const phoneDigits = data.phoneMasked.replace(/\D/g, '');
  const phoneComplete = phoneDigits.length === 11;
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
    <div className="flex flex-col gap-8">
      <div>
        <p className="font-mono text-label text-muted-foreground">Etapa 1 de 3</p>
        <h1 className="text-h1 font-bold">Cadastro pessoal</h1>
        <p className="mt-2 text-body text-muted-foreground">
          Precisamos de algumas informações para criar seu perfil e enviar seu treino
          personalizado pelo WhatsApp.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <FieldLabel htmlFor="name">Qual é o seu nome completo?</FieldLabel>
        <TextInput
          id="name"
          value={data.name}
          onChange={(name) => onChange({ ...data, name })}
          autoComplete="name"
        />
      </div>

      <div className="flex flex-col gap-2">
        <FieldLabel htmlFor="birthDate">Qual é a sua data de nascimento?</FieldLabel>
        <TextInput
          id="birthDate"
          type="date"
          value={data.birthDate}
          onChange={(birthDate) => onChange({ ...data, birthDate })}
          error={underAge}
        />
        <FieldError message={underAge ? UNDER_AGE_MESSAGE : undefined} />
      </div>

      <ChoiceGroup<BiologicalSex>
        legend="Qual é o seu sexo biológico?"
        items={[
          { value: 'FEMALE', label: 'Feminino' },
          { value: 'MALE', label: 'Masculino' },
        ]}
        selected={data.biologicalSex ? [data.biologicalSex] : []}
        onToggle={(biologicalSex) => onChange({ ...data, biologicalSex })}
      />

      <div className="flex flex-col gap-2">
        <FieldLabel htmlFor="phone">Qual é o seu WhatsApp?</FieldLabel>
        <p className="text-label text-muted-foreground">
          Enviaremos seu treino e faremos seu acompanhamento por este número.
        </p>
        <TextInput
          id="phone"
          type="tel"
          inputMode="numeric"
          placeholder="(11) 99999-9999"
          autoComplete="tel-national"
          value={data.phoneMasked}
          onChange={(raw) => onChange({ ...data, phoneMasked: maskPhoneBR(raw) })}
        />
        {phoneComplete && !phoneVerified && (
          <PhoneOtp
            token={token}
            phoneNumber={toE164BR(data.phoneMasked)}
            onVerified={onPhoneVerified}
          />
        )}
        {phoneVerified && (
          <p className="text-label font-semibold text-primary">✓ WhatsApp confirmado</p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <FieldLabel htmlFor="email">Qual é o seu e-mail? (opcional)</FieldLabel>
        <TextInput
          id="email"
          type="email"
          autoComplete="email"
          value={data.email}
          onChange={(email) => onChange({ ...data, email })}
        />
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-input p-4">
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

      <button
        type="button"
        disabled={!canContinue}
        onClick={onContinue}
        className="h-11 rounded-lg bg-primary px-6 text-body font-semibold text-primary-foreground shadow-xs transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
      >
        {saving ? 'Salvando…' : 'CONTINUAR'}
      </button>
    </div>
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
