/**
 * `AuthModule` — **esqueleto vazio registrado** (TASK-0.3.6).
 *
 * Módulo AUTH do C4 nível 3 (`ARQUITETURA.md` §4). Nesta sprint é só a casca:
 * nenhuma lógica de negócio, nenhum controller, nenhum provider. Existe para que a
 * sprint de implementação (Sprint 1-2) encaixe código sem reestruturar o app.
 *
 * Conteúdo previsto pelo diagrama de Rafael:
 *  - `AuthGuard`
 *  - `JwtService`
 *  - `UserService`
 *
 * Regras que já valem para quem implementar:
 *  - JWT assinado em **RS256 com `kid`**, nunca HS256 (Sato §9.1). Chaves via `JWT_PRIVATE_KEY_FILE`.
 *  - Refresh token rotativo com detecção de reuso; sessões revogáveis por dispositivo.
 *  - O telefone é o identificador primário do usuário — nunca aparece em log, span ou nome de chave Redis.
 *
 * # Fronteira do módulo (regra §12.5 — sem imports circulares)
 * Este módulo pode depender do **CORE** (config, banco, Redis, logger) por DI, já que
 * todos os providers do CORE são globais. Não pode importar outro módulo de domínio:
 * a comunicação entre domínios é por evento (`EventBusModule`) ou por fila (`JobsModule`).
 */
import { Module } from '@nestjs/common';

@Module({})
export class AuthModule {}
