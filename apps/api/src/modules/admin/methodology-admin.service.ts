import { createHash } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  createMethodologyVersionSchema,
  methodologyActionSchema,
  type MethodologyVersionsResponse,
} from '@movivo/shared';
import { sql } from 'drizzle-orm';

import type { TenantTransaction } from '../../core/database/tenant-database.service';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { MethodologyProvider } from '../protocol/methodology-provider.service';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { AuditService } from './audit.service';

type MethodologyStatus = 'DRAFT' | 'IN_REVIEW' | 'REJECTED' | 'APPROVED' | 'PUBLISHED' | 'ARCHIVED';

interface MethodologyListRow {
  id: string;
  version: number;
  version_label: string;
  content: string;
  content_sha256: string;
  change_note: string;
  status: MethodologyStatus;
  created_by_name: string | null;
  last_actor_name: string | null;
  created_at: Date;
  status_changed_at: Date;
}

@Injectable()
export class MethodologyAdminService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly provider: MethodologyProvider,
    private readonly audit: AuditService,
  ) {}

  async list(actor: AuthenticatedUser): Promise<MethodologyVersionsResponse> {
    await this.provider.ensureBootstrap();
    const rows = await this.db.runAsUser(actor.userId, actor.role, async (tx) => {
      const result = (await tx.execute(sql`
        SELECT version.id, version.version, version.version_label, version.content,
          version.content_sha256, version.change_note, version.created_at,
          creator.name AS created_by_name, latest.status,
          latest.created_at AS status_changed_at, last_actor.name AS last_actor_name
        FROM methodology_versions version
        LEFT JOIN users creator ON creator.id = version.created_by
        JOIN LATERAL (
          SELECT event.status, event.actor_id, event.created_at
          FROM methodology_events event
          WHERE event.methodology_version_id = version.id
          ORDER BY event.sequence DESC, event.created_at DESC, event.id DESC LIMIT 1
        ) latest ON true
        LEFT JOIN users last_actor ON last_actor.id = latest.actor_id
        ORDER BY version.version DESC
      `)) as unknown as MethodologyListRow[];
      await this.audit.append(tx, {
        actorId: actor.userId,
        userId: actor.userId,
        action: 'methodology.list',
        entityType: 'methodology_version',
        entityId: actor.userId,
        changes: { count: result.length },
      });
      return result;
    });
    const current = rows.find((row) => row.status === 'PUBLISHED');
    return this.envelope({
      versions: rows.map((row) => ({
        id: row.id,
        version: Number(row.version),
        versionLabel: row.version_label,
        content: row.content,
        contentSha256: row.content_sha256,
        changeNote: row.change_note,
        status: row.status,
        createdBy: row.created_by_name,
        lastActor: row.last_actor_name,
        createdAt: new Date(row.created_at).toISOString(),
        statusChangedAt: new Date(row.status_changed_at).toISOString(),
      })),
      currentVersionId: current?.id ?? null,
    });
  }

  async create(actor: AuthenticatedUser, body: unknown): Promise<MethodologyVersionsResponse> {
    const parsed = createMethodologyVersionSchema.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException({ code: 'INVALID_INPUT', issues: parsed.error.issues });
    const input = parsed.data;
    const hash = createHash('sha256').update(input.content).digest('hex');
    await this.db.runAsUser(actor.userId, actor.role, async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('movivo.methodology.workflow'))`);
      const existing = (await tx.execute(sql`
        SELECT id FROM methodology_versions WHERE content_sha256 = ${hash} LIMIT 1
      `)) as unknown as Array<{ id: string }>;
      if (existing.length) throw new ConflictException('Esta metodologia já possui uma versão.');
      const rows = (await tx.execute(sql`
        INSERT INTO methodology_versions (
          version, version_label, content, content_sha256, change_note, created_by
        )
        SELECT COALESCE(max(version), 0) + 1,
          'methodology-v' || (COALESCE(max(version), 0) + 1)::text,
          ${input.content}, ${hash}, ${input.changeNote}, ${actor.userId}::uuid
        FROM methodology_versions
        RETURNING id, version
      `)) as unknown as Array<{ id: string; version: number }>;
      const version = rows[0];
      if (!version) throw new BadRequestException('Não foi possível criar a versão.');
      await this.appendEvent(tx, version.id, 'DRAFT', actor.userId, input.changeNote);
      await this.audit.append(tx, {
        actorId: actor.userId,
        userId: actor.userId,
        action: 'methodology.create',
        entityType: 'methodology_version',
        entityId: version.id,
        changes: { version: Number(version.version), contentSha256: hash },
      });
    });
    return this.list(actor);
  }

  async submit(actor: AuthenticatedUser, body: unknown): Promise<MethodologyVersionsResponse> {
    return this.transition(actor, body, 'DRAFT', 'IN_REVIEW', 'methodology.submit');
  }

  async review(
    actor: AuthenticatedUser,
    body: unknown,
    decision: 'APPROVED' | 'REJECTED',
  ): Promise<MethodologyVersionsResponse> {
    const parsed = methodologyActionSchema.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException({ code: 'INVALID_INPUT', issues: parsed.error.issues });
    const input = parsed.data;
    await this.db.runAsUser(actor.userId, actor.role, async (tx) => {
      await this.lockVersion(tx, input.versionId);
      await this.assertRegulatedActionActor(tx, actor);
      const current = await this.loadCurrent(tx, input.versionId);
      if (!current) throw new NotFoundException('Versão de metodologia inexistente.');
      if (current.status !== 'IN_REVIEW') {
        throw new ConflictException('Somente versão em revisão pode receber parecer.');
      }
      if (actor.role !== 'ADMIN' && current.created_by === actor.userId) {
        throw new ConflictException('Maker-checker: o autor não pode aprovar a própria versão.');
      }
      await this.appendEvent(tx, input.versionId, decision, actor.userId, input.note);
      await this.audit.append(tx, {
        actorId: actor.userId,
        userId: actor.userId,
        action: decision === 'APPROVED' ? 'methodology.approve' : 'methodology.reject',
        entityType: 'methodology_version',
        entityId: input.versionId,
        changes: { note: input.note },
      });
    });
    return this.list(actor);
  }

  async publish(actor: AuthenticatedUser, body: unknown): Promise<MethodologyVersionsResponse> {
    const parsed = methodologyActionSchema.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException({ code: 'INVALID_INPUT', issues: parsed.error.issues });
    const input = parsed.data;
    await this.db.runAsUser(actor.userId, actor.role, async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('movivo.methodology.workflow'))`);
      await this.assertRegulatedActionActor(tx, actor);
      const current = await this.loadCurrent(tx, input.versionId);
      if (!current) throw new NotFoundException('Versão de metodologia inexistente.');
      if (current.status !== 'APPROVED') {
        throw new ConflictException('Somente versão aprovada pode ser publicada.');
      }
      if (actor.role !== 'ADMIN' && current.created_by === actor.userId) {
        throw new ConflictException('Maker-checker: o autor não pode publicar a própria versão.');
      }
      const published = (await tx.execute(sql`
        SELECT version.id
        FROM methodology_versions version
        JOIN LATERAL (
          SELECT event.status FROM methodology_events event
          WHERE event.methodology_version_id = version.id
          ORDER BY event.sequence DESC, event.created_at DESC, event.id DESC LIMIT 1
        ) latest ON latest.status = 'PUBLISHED'::methodology_status
        WHERE version.id <> ${input.versionId}::uuid
      `)) as unknown as Array<{ id: string }>;
      for (const previous of published) {
        await this.appendEvent(
          tx,
          previous.id,
          'ARCHIVED',
          actor.userId,
          `Substituída pela publicação ${input.versionId}.`,
        );
      }
      await this.appendEvent(tx, input.versionId, 'PUBLISHED', actor.userId, input.note);
      await this.audit.append(tx, {
        actorId: actor.userId,
        userId: actor.userId,
        action: 'methodology.publish',
        entityType: 'methodology_version',
        entityId: input.versionId,
        changes: { note: input.note, archived: published.map((item) => item.id) },
      });
    });
    this.provider.invalidate();
    return this.list(actor);
  }

  async rollback(actor: AuthenticatedUser, body: unknown): Promise<MethodologyVersionsResponse> {
    const parsed = methodologyActionSchema.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException({ code: 'INVALID_INPUT', issues: parsed.error.issues });
    const input = parsed.data;
    await this.db.runAsUser(actor.userId, actor.role, async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('movivo.methodology.workflow'))`);
      const source = (await tx.execute(sql`
        SELECT content FROM methodology_versions WHERE id = ${input.versionId}::uuid
      `)) as unknown as Array<{ content: string }>;
      if (!source[0]) throw new NotFoundException('Versão de metodologia inexistente.');
      const hash = createHash('sha256').update(source[0].content).digest('hex');
      const rows = (await tx.execute(sql`
        INSERT INTO methodology_versions (
          version, version_label, content, content_sha256, change_note, created_by
        )
        SELECT COALESCE(max(version), 0) + 1,
          'methodology-v' || (COALESCE(max(version), 0) + 1)::text,
          ${source[0].content}, ${hash},
          ${`Rollback proposto: ${input.note}`}, ${actor.userId}::uuid
        FROM methodology_versions
        RETURNING id, version
      `)) as unknown as Array<{ id: string; version: number }>;
      const copy = rows[0];
      if (!copy) throw new BadRequestException('Não foi possível criar o rollback.');
      await this.appendEvent(tx, copy.id, 'DRAFT', actor.userId, input.note);
      await this.audit.append(tx, {
        actorId: actor.userId,
        userId: actor.userId,
        action: 'methodology.rollback.create',
        entityType: 'methodology_version',
        entityId: copy.id,
        changes: { sourceVersionId: input.versionId, version: Number(copy.version) },
      });
    });
    return this.list(actor);
  }

  private async transition(
    actor: AuthenticatedUser,
    body: unknown,
    from: MethodologyStatus,
    to: MethodologyStatus,
    action: string,
  ): Promise<MethodologyVersionsResponse> {
    const parsed = methodologyActionSchema.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException({ code: 'INVALID_INPUT', issues: parsed.error.issues });
    const input = parsed.data;
    await this.db.runAsUser(actor.userId, actor.role, async (tx) => {
      await this.lockVersion(tx, input.versionId);
      const current = await this.loadCurrent(tx, input.versionId);
      if (!current) throw new NotFoundException('Versão de metodologia inexistente.');
      if (current.status !== from) {
        throw new ConflictException(
          `Transição inválida: esperado ${from}, atual ${current.status}.`,
        );
      }
      await this.appendEvent(tx, input.versionId, to, actor.userId, input.note);
      await this.audit.append(tx, {
        actorId: actor.userId,
        userId: actor.userId,
        action,
        entityType: 'methodology_version',
        entityId: input.versionId,
        changes: { from, to, note: input.note },
      });
    });
    return this.list(actor);
  }

  private async loadCurrent(tx: TenantTransaction, id: string) {
    const rows = (await tx.execute(sql`
      SELECT version.created_by, latest.status
      FROM methodology_versions version
      JOIN LATERAL (
        SELECT event.status FROM methodology_events event
        WHERE event.methodology_version_id = version.id
        ORDER BY event.sequence DESC, event.created_at DESC, event.id DESC LIMIT 1
      ) latest ON true
      WHERE version.id = ${id}::uuid
    `)) as unknown as Array<{ created_by: string | null; status: MethodologyStatus }>;
    return rows[0] ?? null;
  }

  private lockVersion(tx: TenantTransaction, id: string) {
    return tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`methodology:${id}`}, 0))`,
    );
  }

  private async assertRegulatedActionActor(
    tx: TenantTransaction,
    actor: AuthenticatedUser,
  ): Promise<void> {
    if (actor.role === 'ADMIN') return;
    const rows = (await tx.execute(sql`
      SELECT 1 FROM users
      WHERE id = ${actor.userId}::uuid AND role = 'PROFESSIONAL' AND cref_active = true
    `)) as unknown as unknown[];
    if (!rows.length) throw new ConflictException('A ação exige Responsável Técnico CREF ativo.');
  }

  private async appendEvent(
    tx: TenantTransaction,
    versionId: string,
    status: MethodologyStatus,
    actorId: string | null,
    note: string,
  ): Promise<void> {
    await tx.execute(sql`
      INSERT INTO methodology_events (methodology_version_id, sequence, status, actor_id, note)
      SELECT ${versionId}::uuid, COALESCE(max(sequence), 0) + 1,
        ${status}::methodology_status, ${actorId}::uuid, ${note}
      FROM methodology_events WHERE methodology_version_id = ${versionId}::uuid
    `);
  }

  private envelope<T>(data: T): MethodologyVersionsResponse {
    return {
      data,
      meta: {
        generatedAt: new Date().toISOString(),
        timezone: 'America/Sao_Paulo',
        dataQuality: [],
      },
    } as MethodologyVersionsResponse;
  }
}
