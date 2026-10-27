import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  ControlCenterCapability as Capability,
  METHODOLOGY_DOMAIN_SPECS,
  methodologyDomainSchema,
  methodologyDomainSpec,
  methodologyDraftUpdateSchema,
  methodologyOpenDraftSchema,
  plausibilityIssues,
  type MethodologyDomain,
} from '@movivo/shared';

import { strictSafeParse } from '../../core/validation/strict-input';
import { RequireCapabilities } from '../auth/capabilities.decorator';
import { CapabilitiesGuard } from '../auth/capabilities.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { CurrentUser } from '../auth/roles.decorator';
import { MethodologyService } from './methodology.service';

function parseDomain(value: string): MethodologyDomain {
  const parsed = methodologyDomainSchema.safeParse(value);
  if (!parsed.success) throw new BadRequestException('domínio de metodologia desconhecido');
  return parsed.data;
}

function parseBody<T>(schema: Parameters<typeof strictSafeParse<T>>[0], body: unknown): T {
  const result = strictSafeParse(schema, body ?? {});
  if (!result.success) {
    throw new BadRequestException({ message: 'corpo inválido', issues: result.error.issues });
  }
  return result.data;
}

@ApiTags('Estúdio de metodologia')
@ApiBearerAuth('access-token')
@Controller('control-center/methodology')
@UseGuards(JwtAuthGuard, CapabilitiesGuard)
export class MethodologyController {
  constructor(private readonly methodology: MethodologyService) {}

  @Get('domains')
  @RequireCapabilities(Capability.AI_CONFIG_READ)
  @ApiOperation({ summary: 'Domínios de metodologia com a versão publicada e o rascunho aberto' })
  async domains() {
    const domains = [];
    for (const spec of METHODOLOGY_DOMAIN_SPECS) {
      const docs = await this.methodology.listDocuments(spec.domain as MethodologyDomain);
      const published = docs.find((d) => d.status === 'PUBLISHED');
      const open = docs.find((d) => d.status === 'DRAFT' || d.status === 'TESTING');
      domains.push({
        domain: spec.domain,
        title: spec.title,
        description: spec.description,
        owner: spec.owner,
        publishedVersion: published?.version ?? null,
        publishedAt: published?.publishedAt ?? null,
        openDraft: open ? { id: open.id, version: open.version, status: open.status } : null,
      });
    }
    return { data: domains };
  }

  @Get('domains/:domain')
  @RequireCapabilities(Capability.AI_CONFIG_READ)
  @ApiOperation({ summary: 'Histórico de versões do domínio' })
  async domain(@Param('domain') rawDomain: string) {
    const domain = parseDomain(rawDomain);
    return {
      data: {
        versions: (await this.methodology.listDocuments(domain)).map((d) => ({
          id: d.id,
          version: d.version,
          status: d.status,
          changeNote: d.changeNote,
          publishedAt: d.publishedAt,
          createdAt: d.createdAt,
        })),
      },
    };
  }

  @Post('domains/:domain/drafts')
  @RequireCapabilities(Capability.AI_METHODOLOGY_APPROVE)
  @ApiOperation({ summary: 'Abre (ou devolve) o rascunho do domínio; com `fromVersion`, rollback' })
  async openDraft(
    @Param('domain') rawDomain: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const { fromVersion } = parseBody(methodologyOpenDraftSchema, body);
    return {
      data: await this.methodology.openDraft(parseDomain(rawDomain), user.userId, fromVersion),
    };
  }

  @Get('documents/:id')
  @RequireCapabilities(Capability.AI_CONFIG_READ)
  @ApiOperation({
    summary: 'Versão com campos fora da faixa plausível e diferença para a publicada',
  })
  async document(@Param('id', ParseUUIDPipe) id: string) {
    const doc = await this.methodology.get(id);
    return {
      data: {
        document: doc,
        plausibilityIssues: plausibilityIssues(methodologyDomainSpec(doc.domain), doc.parameters),
        diff: await this.methodology.diff(id),
      },
    };
  }

  @Post('documents/:id/update')
  @RequireCapabilities(Capability.AI_METHODOLOGY_APPROVE)
  @ApiOperation({ summary: 'Edita o rascunho (volta para DRAFT e invalida testes anteriores)' })
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return {
      data: await this.methodology.updateDraft(id, parseBody(methodologyDraftUpdateSchema, body)),
    };
  }

  @Post('documents/:id/test')
  @RequireCapabilities(Capability.AI_METHODOLOGY_APPROVE)
  @ApiOperation({ summary: 'Roda os casos de avaliação de todas as tarefas que usam o domínio' })
  async test(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return { data: await this.methodology.test(id, user.userId) };
  }

  @Post('documents/:id/publish')
  @RequireCapabilities(Capability.AI_METHODOLOGY_APPROVE)
  @ApiOperation({ summary: 'Publica a versão aprovada nos testes' })
  async publish(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return { data: await this.methodology.publish(id, user.userId) };
  }

  @Post('documents/:id/discard')
  @RequireCapabilities(Capability.AI_METHODOLOGY_APPROVE)
  @ApiOperation({ summary: 'Descarta o rascunho aberto' })
  async discard(@Param('id', ParseUUIDPipe) id: string) {
    await this.methodology.discardDraft(id);
    return { data: { discarded: true } };
  }
}
