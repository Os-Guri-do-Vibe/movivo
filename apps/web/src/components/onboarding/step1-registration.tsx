'use client';

import * as React from 'react';

import {
  ageInYears,
  MAX_HEIGHT_CM,
  MAX_WEIGHT_KG,
  MIN_AGE_YEARS,
  MIN_HEIGHT_CM,
  MIN_WEIGHT_KG,
  onboardingStep1Schema,
  UNDER_AGE_MESSAGE,
  WHATSAPP_OPERATIONAL_NOTICE,
  type BiologicalSex,
} from '@movivo/shared';

import {
  isPhoneComplete,
  isPhoneInvalid,
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
  FieldValidation,
  QuestionField,
  QuestionStack,
  TextInput,
} from './fields';
import { BIOLOGICAL_SEX_ITEMS } from './anamnesis-options';
import { DatePicker } from './date-picker';
import { maskNumber } from './masks';
import { PhoneInput } from './phone-input';
import { PhoneOtp } from './phone-otp';

export interface Step1Data {
  name: string;
  birthDate: string;
  biologicalSex: BiologicalSex | null;
  heightCm: string;
  weightKg: string;
  phoneCountryIso: PhoneCountryIso;
  phoneMasked: string;
  email: string;
}

function isHeightValid(heightCm: string): boolean {
  const value = Number(heightCm);
  return (
    heightCm.trim().length > 0 &&
    Number.isInteger(value) &&
    value >= MIN_HEIGHT_CM &&
    value <= MAX_HEIGHT_CM
  );
}

function isWeightValid(weightKg: string): boolean {
  const value = Number(weightKg.replace(',', '.'));
  return (
    weightKg.trim().length > 0 &&
    Number.isFinite(value) &&
    value >= MIN_WEIGHT_KG &&
    value <= MAX_WEIGHT_KG
  );
}

function isEmailValid(email: string): boolean {
  return onboardingStep1Schema.shape.email.safeParse(email.trim()).success;
}

const MAX_NAME_LENGTH = 120;
/** Letras de qualquer idioma, com acento, espaço, hífen, ponto e apóstrofo entre elas. */
const NAME_PATTERN = /^\p{L}[\p{L}\p{M}'’. -]*$/u;

function nameError(name: string): string | undefined {
  const clean = name.trim();
  if (clean === '') return undefined;
  if (clean.length < 2) return 'Informe seu nome completo.';
  return NAME_PATTERN.test(clean)
    ? undefined
    : 'Use só letras no nome. Acentos, espaço, hífen e apóstrofo são aceitos.';
}

/** Mais de 120 anos é erro de digitação, não aluno. */
const MAX_AGE_YEARS = 120;

export function Step1Registration({
  data,
  onChange,
  consents,
  acceptedConsents,
  onToggleConsent,
  phoneVerified,
  onPhoneVerified,
  sessionRef,
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
  sessionRef: string;
  onContinue: () => void;
  saving: boolean;
}) {
  const age = data.birthDate ? ageInYears(data.birthDate) : null;
  const underAge = age !== null && age < MIN_AGE_YEARS;
  const phoneComplete = isPhoneComplete(data.phoneCountryIso, data.phoneMasked);
  const phoneE164 = toE164(data.phoneCountryIso, data.phoneMasked);
  const requiredConsents = consents.filter((c) => c.required);
  const allRequiredAccepted = requiredConsents.every((c) => acceptedConsents.has(c.type));
  const emailInvalid = data.email.trim().length > 0 && !isEmailValid(data.email);
  const heightInvalid = data.heightCm.trim() !== '' && !isHeightValid(data.heightCm);
  const weightInvalid = data.weightKg.trim() !== '' && !isWeightValid(data.weightKg);
  const phoneInvalid = isPhoneInvalid(data.phoneCountryIso, data.phoneMasked);
  const [oldestBirthDate] = React.useState(() => {
    const today = new Date();
    return new Date(today.getFullYear() - MAX_AGE_YEARS, 0, 1);
  });

  const canContinue =
    data.name.trim().length >= 2 &&
    !nameError(data.name) &&
    data.birthDate.length === 10 &&
    !underAge &&
    data.biologicalSex !== null &&
    isHeightValid(data.heightCm) &&
    isWeightValid(data.weightKg) &&
    phoneVerified &&
    isEmailValid(data.email) &&
    allRequiredAccepted &&
    !saving;

  return (
    <QuestionStack className="pb-4">
      <div className="text-center">
        <h1 className="text-h1 font-bold text-petroleo">Vamos começar por você</h1>
        <p className="mt-2 text-body text-muted-foreground">
          Seus dados básicos. Idade, sexo biológico, altura e peso entram nos cálculos do seu treino
          e da sua alimentação, que os profissionais da MOVIVO revisam.
        </p>
      </div>

      <QuestionField>
        <FieldLabel htmlFor="name">Qual é o seu nome completo?</FieldLabel>
        <FieldValidation error={nameError(data.name)}>
          <TextInput
            id="name"
            value={data.name}
            onChange={(name) => onChange({ ...data, name })}
            autoComplete="name"
            maxLength={MAX_NAME_LENGTH}
          />
        </FieldValidation>
      </QuestionField>

      <QuestionField>
        <FieldLabel htmlFor="birthDate">Qual é a sua data de nascimento?</FieldLabel>
        <DatePicker
          id="birthDate"
          value={data.birthDate}
          onChange={(birthDate) => onChange({ ...data, birthDate })}
          error={underAge}
          autoComplete="bday"
          minDate={oldestBirthDate}
          invalidMessage="Informe uma data de nascimento válida, no formato dd/mm/aaaa."
        />
        <FieldError message={underAge ? UNDER_AGE_MESSAGE : undefined} />
      </QuestionField>

      <ChoiceGroup<BiologicalSex>
        legend="Qual é o seu sexo biológico?"
        help="Usado só nos cálculos, como gasto de energia e progressão de carga."
        items={BIOLOGICAL_SEX_ITEMS}
        selected={data.biologicalSex ? [data.biologicalSex] : []}
        onToggle={(biologicalSex) => onChange({ ...data, biologicalSex })}
      />

      <FieldValidation
        error={
          [
            heightInvalid &&
              `Informe a altura em centímetros, entre ${MIN_HEIGHT_CM} e ${MAX_HEIGHT_CM}.`,
            weightInvalid && `Informe o peso em quilos, entre ${MIN_WEIGHT_KG} e ${MAX_WEIGHT_KG}.`,
          ]
            .filter(Boolean)
            .join(' ') || undefined
        }
      >
        <div className="grid grid-cols-2 gap-x-3 gap-y-2">
          <QuestionField className="row-span-2 grid grid-rows-subgrid">
            <FieldLabel htmlFor="heightCm">Qual é a sua altura? (cm)</FieldLabel>
            <TextInput
              id="heightCm"
              value={data.heightCm}
              onChange={(heightCm) => onChange({ ...data, heightCm: maskNumber(heightCm, 3, 0) })}
              type="text"
              inputMode="numeric"
              placeholder="Ex.: 170"
              maxLength={3}
            />
          </QuestionField>

          <QuestionField className="row-span-2 grid grid-rows-subgrid">
            <FieldLabel htmlFor="weightKg">Qual é o seu peso hoje? (kg)</FieldLabel>
            <TextInput
              id="weightKg"
              value={data.weightKg}
              onChange={(weightKg) => onChange({ ...data, weightKg: maskNumber(weightKg, 3, 1) })}
              type="text"
              inputMode="decimal"
              placeholder="Ex.: 70"
              maxLength={5}
            />
          </QuestionField>
        </div>
      </FieldValidation>

      <QuestionField>
        <FieldLabel htmlFor="phone">Qual é o seu WhatsApp?</FieldLabel>
        <FieldHelp>
          É por ele que você recebe seu plano e conversa com a MOVIVO. Vamos enviar um código para
          confirmar o número.
        </FieldHelp>
        <PhoneInput
          id="phone"
          countryIso={data.phoneCountryIso}
          value={data.phoneMasked}
          onChange={(phoneMasked) => onChange({ ...data, phoneMasked })}
          onCountryChange={(phoneCountryIso, phoneMasked) =>
            onChange({ ...data, phoneCountryIso, phoneMasked })
          }
        />
        <FieldError
          message={
            phoneInvalid
              ? 'Confira o número: ele não parece um celular válido para o país escolhido.'
              : undefined
          }
        />
        {phoneComplete && !phoneVerified && (
          <PhoneOtp
            sessionRef={sessionRef}
            phoneNumber={phoneE164}
            onVerified={onPhoneVerified}
            anchorId="phone"
          />
        )}
        {phoneVerified && (
          <p className="text-label font-semibold text-petroleo">✓ WhatsApp confirmado</p>
        )}
      </QuestionField>

      <QuestionField>
        <FieldLabel htmlFor="email">Qual é o seu e-mail?</FieldLabel>
        <FieldValidation
          error={emailInvalid ? 'Digite um e-mail válido, como nome@exemplo.com.' : undefined}
        >
          <TextInput
            id="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            value={data.email}
            onChange={(email) => onChange({ ...data, email: email.replace(/\s/g, '') })}
            maxLength={255}
          />
        </FieldValidation>
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

/** Destinos aceitos no texto do consentimento: só HTTPS ou caminho do próprio site. */
const SAFE_HREF = /^(https:\/\/|\/(?!\/))/i;

/** Renderiza o `label` do consentimento com o link de Termos, sem alterar o texto do backend. */
export function ConsentLabel({ consent }: { consent: ConsentItemView }) {
  const parts = consent.label.split(/(\[[^\]]+\]\([^)]+\))/g);
  return (
    <>
      {parts.map((part, i) => {
        const match = /\[([^\]]+)\]\(([^)]+)\)/.exec(part);
        if (!match) return <React.Fragment key={i}>{part}</React.Fragment>;
        const [, text, href = ''] = match;
        // Um destino fora do padrão (ex.: `javascript:`) vira texto puro, nunca link.
        if (!SAFE_HREF.test(href.trim())) return <React.Fragment key={i}>{text}</React.Fragment>;
        return (
          <a
            key={i}
            href={href.trim()}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            {text}
          </a>
        );
      })}
    </>
  );
}
