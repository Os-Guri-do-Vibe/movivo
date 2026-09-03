/**
 * `AccountService` — perfil da própria conta interna do dashboard (tela "Minha Conta").
 *
 * Escopo deliberadamente estreito: todo método aqui lê/escreve só a linha do PRÓPRIO
 * usuário autenticado (`runAsUser` — a RLS de `users` libera UPDATE na própria linha,
 * ver `security-policies.ts`). Isto não é gestão de conta de terceiro — isso é
 * `AdminModule`. E-mail é IMUTÁVEL por decisão do fundador (é o e-mail corporativo):
 * não existe update para esse campo aqui, de propósito.
 */
import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { ChangePasswordInput, UpdateAccountProfileInput } from '@movivo/shared';
import { eq } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';

import { AppConfigService } from '../../core/config';
import { TenantDatabase, type TenantRole } from '../../core/database';
import { users } from '../../core/database/schema';
import { PasswordService } from '../auth/password.service';
import { AvatarStorageService, type UploadedAvatarFile } from './avatar-storage.service';

export interface AccountProfileView {
  name: string | null;
  email: string | null;
  phoneNumber: string;
  avatarUrl: string | null;
  role: TenantRole;
}

/**
 * Postgres devolve `code: '23505'` para violação de UNIQUE, mas o Drizzle (0.45.2)
 * embrulha o erro do driver num `DrizzleQueryError` quando a query passa pelo query
 * builder (`.update()`/`.insert()`) — o código real fica em `error.cause.code`, não em
 * `error.code` (achado 2026-09-02, via `test/account.int-spec.ts`: sem isto o conflito
 * de telefone duplicado vazava como 500 em vez de 409). Checa os dois formatos porque
 * uma query via `sql`/`tx.execute()` crua não passa por esse wrapper.
 */
function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: unknown; cause?: { code?: unknown } } | null)?.code;
  if (code === '23505') return true;
  const causeCode = (error as { cause?: { code?: unknown } } | null)?.cause?.code;
  return causeCode === '23505';
}

@Injectable()
export class AccountService {
  constructor(
    private readonly logger: PinoLogger,
    private readonly db: TenantDatabase,
    private readonly config: AppConfigService,
    private readonly passwords: PasswordService,
    private readonly avatarStorage: AvatarStorageService,
  ) {
    this.logger.setContext(AccountService.name);
  }

  async getProfile(userId: string, role: TenantRole): Promise<AccountProfileView> {
    const [row] = await this.db.runAsUser(userId, role, (tx) =>
      tx
        .select({
          name: users.name,
          email: users.email,
          phoneNumber: users.phoneNumber,
          avatarPath: users.avatarPath,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1),
    );
    if (!row) throw new UnauthorizedException('Conta não encontrada.');
    return {
      name: row.name,
      email: row.email,
      phoneNumber: row.phoneNumber,
      avatarUrl: this.config.avatarUrl(row.avatarPath),
      role,
    };
  }

  async updateProfile(
    userId: string,
    role: TenantRole,
    input: UpdateAccountProfileInput,
  ): Promise<AccountProfileView> {
    try {
      await this.db.runAsUser(userId, role, (tx) =>
        tx
          .update(users)
          .set({
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.phoneNumber !== undefined ? { phoneNumber: input.phoneNumber } : {}),
          })
          .where(eq(users.id, userId)),
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('Este telefone já está em uso por outra conta.');
      }
      throw error;
    }
    this.logger.info({ event: 'account_profile_updated', userId }, 'perfil da conta atualizado');
    return this.getProfile(userId, role);
  }

  async changePassword(
    userId: string,
    role: TenantRole,
    input: ChangePasswordInput,
  ): Promise<void> {
    const [row] = await this.db.runAsUser(userId, role, (tx) =>
      tx
        .select({ passwordHash: users.passwordHash })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1),
    );
    const ok = await this.passwords.verify(row?.passwordHash ?? null, input.currentPassword);
    if (!row || !ok) throw new UnauthorizedException('Senha atual incorreta.');

    const passwordHash = await this.passwords.hash(input.newPassword);
    await this.db.runAsUser(userId, role, (tx) =>
      tx.update(users).set({ passwordHash }).where(eq(users.id, userId)),
    );
    this.logger.info({ event: 'account_password_changed', userId }, 'senha da conta alterada');
  }

  async updateAvatar(
    userId: string,
    role: TenantRole,
    file: UploadedAvatarFile,
  ): Promise<AccountProfileView> {
    const [existing] = await this.db.runAsUser(userId, role, (tx) =>
      tx.select({ avatarPath: users.avatarPath }).from(users).where(eq(users.id, userId)).limit(1),
    );
    const filename = await this.avatarStorage.save(file);
    await this.db.runAsUser(userId, role, (tx) =>
      tx.update(users).set({ avatarPath: filename }).where(eq(users.id, userId)),
    );
    if (existing?.avatarPath) await this.avatarStorage.delete(existing.avatarPath);
    this.logger.info({ event: 'account_avatar_updated', userId }, 'avatar da conta atualizado');
    return this.getProfile(userId, role);
  }
}
