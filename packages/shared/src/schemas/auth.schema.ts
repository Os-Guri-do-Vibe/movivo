/**
 * Contrato de autenticação (US-1.4) — login do dashboard de operações.
 *
 * No MVP quem se autentica é o **profissional CREF** e o **admin** (o titular final
 * acessa pelo WhatsApp e o formulário por token — ADR-006). O login é por e-mail +
 * senha; a senha é verificada com Argon2id no servidor e nunca trafega/loga em claro.
 */
import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email().max(255),
  /** Só presença; a política de força de senha é do provisionamento, não do login. */
  password: z.string().min(1).max(200),
});

export type LoginInput = z.infer<typeof loginSchema>;
