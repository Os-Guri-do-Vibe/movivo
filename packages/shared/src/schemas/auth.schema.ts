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
