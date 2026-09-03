/**
 * `AccountModule` — autoatendimento da própria conta interna (tela "Minha Conta").
 *
 * Importa só `AuthModule` (reusa `PasswordService` e `JwtAuthGuard`, já exportados de
 * lá) — sem outro módulo de domínio, mesma regra de fronteira do `AuthModule` (§12.5).
 */
import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';
import { AvatarStorageService } from './avatar-storage.service';

@Module({
  imports: [AuthModule],
  controllers: [AccountController],
  providers: [AccountService, AvatarStorageService],
})
export class AccountModule {}
