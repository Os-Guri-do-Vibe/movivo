/**
 * `PasswordService` — hashing e verificação de senha com Argon2id (US-1.4 / TASK-1.4.3).
 *
 * Argon2id é o algoritmo recomendado (OWASP): resistente a GPU e a side-channel. A senha
 * em claro nunca é logada (o LoggerModule redige `password`) nem persistida — só o
 * *encoded hash* vai para `users.password_hash`.
 */
import { Injectable } from '@nestjs/common';
import argon2 from 'argon2';

/**
 * Hash Argon2id fixo e válido, usado como alvo de verificação quando o e-mail não
 * existe. Verificar contra ele equaliza o tempo de resposta e nega o oráculo de
 * enumeração de usuários (a resposta demora o mesmo com e sem conta). Não é segredo:
 * é a hash de uma string pública descartável.
 */
const DUMMY_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$WIp9ebnsRJ6vW5pOx0Fxow$6z9ZOh8eB9p2R9i4KqCVS8u2HmKHrjsGXhtWvNpYenw';

@Injectable()
export class PasswordService {
  private readonly options: argon2.Options = { type: argon2.argon2id };

  hash(plain: string): Promise<string> {
    return argon2.hash(plain, this.options);
  }

  /** Verifica a senha. `hash` nulo ⇒ verifica contra o dummy (mesmo custo de tempo). */
  async verify(hash: string | null, plain: string): Promise<boolean> {
    if (hash === null) {
      await argon2.verify(DUMMY_HASH, plain).catch(() => false);
      return false;
    }
    try {
      return await argon2.verify(hash, plain);
    } catch {
      return false;
    }
  }
}
