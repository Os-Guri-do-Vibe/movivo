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
  methodologyStartTestSchema,
  plausibilityIssues,
  type DomainSpec,
  type MethodologyDomain,
} from '@movivo/shared';

import { strictSafeParse } from '../../core/validation/strict-input';
import { RequireCapabilities } from '../auth/capabilities.decorator';
import { CapabilitiesGuard } from '../auth/capabilities.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { CurrentUser } from '../auth/roles.decorator';
import { readableBodyIssues } from './methodology-issues';
import { MethodologyService } from './methodology.service';

function parseDomain(value: string): MethodologyDomain {
  const parsed = methodologyDomainSchema.safeParse(value);
  if (!parsed.success) throw new BadRequestException('Este domínio de metodologia não existe.');
  return parsed.data;
}

function parseBody<T>(
  schema: Parameters<typeof strictSafeParse<T>>[0],
  body: unknown,
  spec?: DomainSpec,
): T {
  const result = strictSafeParse(schema, body ?? {});
  if (!result.success) {
    throw new BadRequestException({
      message: 'Alguns dados enviados não são válidos. Corrija os campos abaixo e tente de novo.',
      issues: readableBodyIssues(spec, result.error.issues),
    });
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
    const { domain } = await this.methodology.get(id);
    const update = parseBody(methodologyDraftUpdateSchema, body, methodologyDomainSpec(domain));
    return { data: await this.methodology.updateDraft(id, update) };
  }

  @Post('documents/:id/test')
  @RequireCapabilities(Capability.AI_METHODOLOGY_APPROVE)
  @ApiOperation({
    summary: 'Inicia, em segundo plano, os casos de avaliação das tarefas que usam o domínio',
  })
  async test(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    // O teste usa modelos de IA reais e gera custo: só começa com o limite de gasto confirmado.
    const { budgetBrl } = parseBody(methodologyStartTestSchema, body);
    return { data: await this.methodology.startTest(id, user.userId, budgetBrl) };
  }

  @Get('documents/:id/test/estimate')
  @RequireCapabilities(Capability.AI_CONFIG_READ)
  @ApiOperation({ summary: 'Custo estimado do teste, antes de chamar os modelos' })
  async testEstimate(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.methodology.estimateTest(id) };
  }

  @Post('documents/:id/test/cancel')
  @RequireCapabilities(Capability.AI_METHODOLOGY_APPROVE)
  @ApiOperation({ summary: 'Cancela o teste em andamento antes da próxima tarefa' })
  cancelTest(@Param('id', ParseUUIDPipe) id: string) {
    return { data: this.methodology.cancelTest(id) };
  }

  @Get('documents/:id/test')
  @RequireCapabilities(Capability.AI_CONFIG_READ)
  @ApiOperation({ summary: 'Andamento do teste do rascunho' })
  testProgress(@Param('id', ParseUUIDPipe) id: string) {
    return { data: this.methodology.testProgress(id) };
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
