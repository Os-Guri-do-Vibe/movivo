import { z } from 'zod';

import { ProtocolStatus, SubscriptionStatus } from '../enums';

/**
 * Schemas Zod primitivos compartilhados entre backend e frontend.
 *
 * Regra do ARQUITETURA.md §2/§8: **todo DTO de entrada é validado por Zod**.
 * O mesmo schema serve de validação no `ValidationPipe` do NestJS e no formulário
 * do Next.js — fonte única de verdade do contrato, sem divergência entre as pontas.
 *
 * Esta US (0.1) entrega apenas os primitivos e a fundação; os DTOs de domínio
 * (anamnese, PAR-Q, protocolo, check-in) nascem nas sprints correspondentes.
 */

/** UUID (PK padrão do schema). */
export const uuidSchema = z.uuid();

/** Timestamp ISO-8601 em UTC. */
export const isoDateTimeSchema = z.iso.datetime();

/** Status de assinatura, derivado do enum de domínio — nunca duplicar os literais. */
export const subscriptionStatusSchema = z.enum(SubscriptionStatus);

/** Status de protocolo, derivado do enum de domínio. */
export const protocolStatusSchema = z.enum(ProtocolStatus);

/** Query de paginação por cursor (padrão de todas as listagens da API v1). */
export const paginationQuerySchema = z.object({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;
