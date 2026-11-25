import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Injectable,
  NotFoundException,
  Param,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';

import { AppConfigService } from '../../core/config';
import { AccessLinkService } from '../../core/database/access-link.service';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { QUEUE } from '../jobs/jobs.config';
import { QueueManager } from '../jobs/queue-manager.service';
import type { WhatsappOutboundJob } from '../jobs/whatsapp-outbound.contract';
import { loadMonthlyReport, monthlyReportPdf, reportMessage } from './monthly-report';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const LINK_TTL_MS = 30 * 86_400_000;

/** Envia o relatório do mês pelo WhatsApp: resumo em texto + PDF baixado pela EvolutionAPI. */
@Injectable()
export class MonthlyReportService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly accessLinks: AccessLinkService,
    private readonly queues: QueueManager,
    private readonly config: AppConfigService,
  ) {}

  async send(userId: string, month: string): Promise<boolean> {
    const report = await this.db.runAsUser(userId, 'USER', (tx) =>
      loadMonthlyReport(tx, userId, month),
    );
    // Mês sem nada acontecendo não vira relatório vazio no WhatsApp.
    if (!report || (report.sessions.planned === 0 && report.checkIns.answered === 0)) return false;
    const { token } = await this.accessLinks.issue('PLAN', userId, userId, LINK_TTL_MS);
    const dedupeId = `monthly-report_${userId}_${month}`;
    const job: WhatsappOutboundJob = {
      userId,
      type: 'CONVERSATION_MESSAGE',
      dedupeId,
      text: reportMessage(report),
      documents: [
        {
          url: `${this.config.apiPublicUrl}/${this.config.globalPrefix}/reports/by-token/${token}/${month}`,
          fileName: `MOVIVO-relatorio-${month}.pdf`,
          caption: `Relatório de ${report.label}`,
        },
      ],
    };
    await this.queues.enqueue(QUEUE.whatsappOutbound, 'monthly-report', job, { jobId: dedupeId });
    return true;
  }
}

@ApiTags('Plano')
@Controller('reports')
@UseGuards(ThrottlerGuard)
export class MonthlyReportController {
  constructor(
    private readonly db: TenantDatabase,
    private readonly accessLinks: AccessLinkService,
  ) {}

  @Get('by-token/:token/:month')
  @Header('Referrer-Policy', 'no-referrer')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'PDF do relatório mensal por token (público)',
    description: 'Mesmo token da página do plano; gerado na hora e nunca armazenado. 404 uniforme.',
  })
  async pdf(@Param('token') token: string, @Param('month') month: string): Promise<StreamableFile> {
    if (!MONTH.test(month)) throw new BadRequestException('Mês inválido.');
    const verified = await this.accessLinks.verify(token, 'PLAN');
    if (!verified) throw new NotFoundException();
    const report = await this.db.runAsUser(verified.userId, 'USER', (tx) =>
      loadMonthlyReport(tx, verified.userId, month),
    );
    if (!report) throw new NotFoundException();
    return new StreamableFile(await monthlyReportPdf(report), {
      type: 'application/pdf',
      disposition: `inline; filename="MOVIVO-relatorio-${month}.pdf"`,
    });
  }
}
