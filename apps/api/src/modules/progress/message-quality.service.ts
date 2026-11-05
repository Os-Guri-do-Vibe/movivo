/**
 * Auditoria de qualidade em produção: cada mensagem que um agente envia passa pelas checagens do
 * código e, em amostra (ou sob desconfiança), pelo juiz. Mensagem fraca abre um alerta para a
 * equipe, que audita sem travar o acompanhamento. Falhar aqui nunca atrapalha o envio.
 */
import { Injectable } from '@nestjs/common';
import { gte, sql } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';

import { WHATSAPP_BUBBLE_SEPARATOR } from '@movivo/shared';

import { AgentRunner, AgentTaskError } from '../../core/agents/agent-runner';
import { messageQualityReviews } from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { DecisionPipeline } from '../coaching/decision/decision-pipeline.service';
import { ConversationStore } from '../conversation/conversation-store';
import type { FollowUpJob } from '../jobs/follow-up.contract';
import { OutboxRelay } from '../domain-events/outbox-relay';
import { PublishedMethodologyReader } from '../methodology/published-methodology.reader';
import { OutreachService } from '../student-state/outreach.service';
import { StudentStateReader } from '../student-state/student-state.reader';
import {
  overallOf,
  qualityChecks,
  shouldJudge,
  verdictOf,
  type QualityCriterion,
} from './message-quality';
import { qualityReviewTask } from './message-quality-tasks';

type QualityJob = Extract<FollowUpJob, { kind: 'QUALITY_REVIEW' }>;

const PREVIOUS_MESSAGES = 6;

@Injectable()
export class MessageQualityService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly runner: AgentRunner,
    private readonly state: StudentStateReader,
    private readonly methodology: PublishedMethodologyReader,
    private readonly store: ConversationStore,
    private readonly pipeline: DecisionPipeline,
    private readonly outbox: OutboxRelay,
    private readonly outreach: OutreachService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(MessageQualityService.name);
  }

  async review(job: QualityJob, roll: number = Math.random()) {
    const { userId, dedupeId, flow, text } = job;
    const now = new Date();
    const { firstName } = await this.store.loadUser(userId);
    const read = await this.state.read(userId, ['conversation'], now);
    const turns =
      (read.slices.conversation as { turns?: Array<{ from: string; text: string }> } | null)
        ?.turns ?? [];
    const previous = turns
      .filter((t) => t.from === 'coach' && t.text !== text)
      .slice(-PREVIOUS_MESSAGES)
      .map((t) => t.text);

    const checks = qualityChecks({
      text: text.split(WHATSAPP_BUBBLE_SEPARATOR).join(' '),
      firstName,
      previous,
    });

    let scores: Record<QualityCriterion, number> | null = null;
    let issue: string | null = null;
    if (shouldJudge(checks, roll)) {
      try {
        const run = await this.runner.run(
          qualityReviewTask,
          {
            flow,
            message: text.split(WHATSAPP_BUBBLE_SEPARATOR).join('\n'),
            codeChecks: {
              repeated: checks.repeated,
              tooLong: checks.tooLong,
              noAnchor: checks.noAnchor,
            },
          },
          {
            userId,
            sources: {
              methodology: (domains) => this.methodology.render(domains),
              state: (slices) => this.state.read(userId, slices, now),
            },
          },
        );
        scores = run.output.scores;
        issue = run.output.issue;
      } catch (error) {
        if (!(error instanceof AgentTaskError)) throw error;
        this.logger.warn({ userId, flow }, 'juiz de qualidade sem avaliação válida');
      }
    }

    const verdict = verdictOf(checks, scores);
    await this.db.runAsSystem((tx) =>
      tx
        .insert(messageQualityReviews)
        .values({
          userId,
          dedupeId: dedupeId.slice(0, 120),
          flow: flow.slice(0, 40),
          checks: checks as unknown as Record<string, unknown>,
          scores: scores as unknown as Record<string, unknown> | null,
          judged: scores !== null,
          verdict,
          overall: scores ? overallOf(scores) : null,
        })
        .onConflictDoNothing(),
    );

    if (verdict === 'REVIEW') {
      const reasons = [
        checks.guilt && 'tom de cobrança',
        checks.promise && 'promessa de resultado',
        checks.clinical && 'termo clínico',
        checks.repeated && 'mensagem repetida',
        checks.tooLong && 'mensagem longa demais',
        issue,
      ].filter((r): r is string => typeof r === 'string');
      await this.db.runAsSystem((tx) =>
        this.pipeline.openCase(tx, {
          userId,
          kind: 'NO_APPLICABLE_POLICY',
          domain: 'GENERAL',
          summary: `Auditoria de qualidade: mensagem do fluxo ${flow} merece revisão (${reasons.join('; ') || 'notas baixas'}).`,
          subject: { source: 'MESSAGE_QUALITY', dedupeId, flow },
          priority: 'NORMAL',
        }),
      );
      await this.outbox.flushSoon();
    }
    return { status: 'REVIEWED' as const, verdict, judged: scores !== null };
  }

  /** Painel de qualidade: veredito por fluxo, nota média do juiz e eficácia dos contatos proativos. */
  async summary(days = 30) {
    const since = new Date(Date.now() - days * 86_400_000);
    const byFlow = await this.db.runAsSystem((tx) =>
      tx
        .select({
          flow: messageQualityReviews.flow,
          total: sql<number>`count(*)::int`,
          judged: sql<number>`count(*) filter (where ${messageQualityReviews.judged})::int`,
          review: sql<number>`count(*) filter (where ${messageQualityReviews.verdict} = 'REVIEW')::int`,
          avgOverall: sql<
            number | null
          >`round(avg(${messageQualityReviews.overall})::numeric, 2)::float`,
          repeated: sql<number>`count(*) filter (where (${messageQualityReviews.checks}->>'repeated')::boolean)::int`,
        })
        .from(messageQualityReviews)
        .where(gte(messageQualityReviews.createdAt, since))
        .groupBy(messageQualityReviews.flow),
    );
    const outreach = await this.outreach.effectiveness(since);
    return {
      days,
      flows: byFlow.map((f) => ({
        ...f,
        reviewRate: f.total > 0 ? Math.round((f.review / f.total) * 100) / 100 : 0,
      })),
      outreach: outreach.map((o) => ({
        ...o,
        responseRate: o.sent > 0 ? Math.round((o.responded / o.sent) * 100) / 100 : 0,
      })),
    };
  }
}
