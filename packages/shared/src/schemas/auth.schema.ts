/**
 * Contrato de autenticação (US-1.4) — login do dashboard de operações.
 *
 * No MVP quem se autentica é o **profissional CREF** e o **admin** (o titular final
 * acessa pelo WhatsApp e o formulário por token — ADR-006). O login é por e-mail +
 * senha; a senha é verificada com Argon2id no servidor e nunca trafega/loga em claro.
 */
import { z } from 'zod';

import { phoneE164Schema } from './anamnesis.schema';

export const loginSchema = z.object({
  email: z.string().email().max(255),
  /** Só presença; a política de força de senha é do provisionamento, não do login. */
  password: z.string().min(1).max(200),
});

export type LoginInput = z.infer<typeof loginSchema>;

/**
 * Segundo fator (TOTP) — o login vira dois passos. `POST /auth/login` com senha correta e MFA
 * pendente NÃO devolve sessão: devolve `{ mfa: { step, challengeToken } }`, um token opaco de
 * uso único (5 min) que só serve para resolver o desafio nas rotas `/auth/mfa/*`.
 *  - `verify`: a conta já tem MFA — informar o código do app (ou um código de recuperação).
 *  - `setup`: a instalação exige MFA e a conta ainda não tem — inscrever-se e confirmar.
 */
export const mfaChallengeTokenSchema = z.string().regex(/^[0-9a-f]{64}$/);

/** 6 dígitos do app autenticador OU código de recuperação `XXXXX-XXXXX` (com/sem hífen). */
export const mfaCodeSchema = z
  .string()
  .trim()
  .min(6)
  .max(14)
  .regex(/^[0-9A-Za-z -]+$/, 'Código inválido.');

export const mfaSetupSchema = z.object({ challengeToken: mfaChallengeTokenSchema });
export const mfaVerifySchema = z.object({
  challengeToken: mfaChallengeTokenSchema,
  code: mfaCodeSchema,
});
export const mfaEnableSchema = mfaVerifySchema;

export type MfaSetupInput = z.infer<typeof mfaSetupSchema>;
export type MfaVerifyInput = z.infer<typeof mfaVerifySchema>;

export const mfaStepSchema = z.enum(['verify', 'setup']);
export type MfaStep = z.infer<typeof mfaStepSchema>;

/** Resposta do `login`: sessão completa OU desafio de MFA (nunca os dois). */
export const mfaChallengeResponseSchema = z.object({
  mfa: z.object({ step: mfaStepSchema, challengeToken: mfaChallengeTokenSchema }),
});
export type MfaChallengeResponse = z.infer<typeof mfaChallengeResponseSchema>;

export const mfaSetupResponseSchema = z.object({
  /** Chave em base32 para digitar à mão no app (caso o QR não funcione). */
  secret: z.string(),
  otpauthUri: z.string(),
  account: z.string(),
});
export type MfaSetupResponse = z.infer<typeof mfaSetupResponseSchema>;

/**
 * `PATCH /account/profile` (tela "Minha Conta"): nome e telefone da própria conta
 * interna. Sem `email` — é o e-mail corporativo, imutável por decisão do fundador
 * (Rodrigo, 2026-09-02). Ao menos um campo precisa vir preenchido.
 */
export const updateAccountProfileSchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    phoneNumber: phoneE164Schema.optional(),
  })
  .refine((value) => value.name !== undefined || value.phoneNumber !== undefined, {
    message: 'Informe ao menos um campo para atualizar.',
  });

export type UpdateAccountProfileInput = z.infer<typeof updateAccountProfileSchema>;

/**
 * `POST /account/password`: troca de senha autoatendida, exige a senha atual (defesa
 * contra sequestro de sessão — um access token de 15min sozinho não basta pra assumir
 * a conta). Mesmo piso de 12 caracteres do provisionamento (`DEV_PROFESSIONAL_PASSWORD`).
 */
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(12).max(200),
});

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
