/**
 * Mantém a memória do aluno: depois de uma rajada de conversa, o curador lê o trecho recente e
 * registra o que vale lembrar (ou aposenta o que deixou de valer). Falha do curador nunca
 * atrapalha o atendimento: sem leitura válida, a memória simplesmente fica como estava.
 */
import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import { AgentRunner, AgentTaskError } from '../../core/agents/agent-runner';
import { PublishedMethodologyReader } from '../methodology/published-methodology.reader';
import { StudentMemoryService } from '../student-state/student-memory.service';
import { StudentStateReader } from '../student-state/student-state.reader';
import { memoryCurationTask } from './memory-tasks';

export type MemoryCurationResult =
  | { status: 'SKIPPED'; reason: 'NO_CONVERSATION' | 'NO_STUDENT_TURN' | 'NO_VALID_CURATION' }
  | { status: 'CURATED'; inserted: number; bumped: number; retired: number };

interface Turn {
  from: 'student' | 'coach';
  text: string;
}

@Injectable()
export class MemoryCuratorService {
  constructor(
    private readonly runner: AgentRunner,
    private readonly state: StudentStateReader,
    private readonly methodology: PublishedMethodologyReader,
    private readonly memory: StudentMemoryService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(MemoryCuratorService.name);
  }

  async handle(userId: string, now: Date = new Date()): Promise<MemoryCurationResult> {
    const read = await this.state.read(userId, ['conversation'], now);
    const turns = ((read.slices.conversation as { turns?: Turn[] } | undefined)?.turns ?? []).slice(
      -10,
    );
    if (turns.length === 0) return { status: 'SKIPPED', reason: 'NO_CONVERSATION' };
    if (!turns.some((t) => t.from === 'student')) {
      return { status: 'SKIPPED', reason: 'NO_STUDENT_TURN' };
    }

    const existing = await this.memory.active(userId);
    let curation;
    try {
      curation = (
        await this.runner.run(
          memoryCurationTask,
          {
            existing: existing.map(({ id, kind, text }) => ({ id, kind, text })),
            turns: turns.map(({ from, text }) => ({ from, text })),
          },
          {
            userId,
            sources: {
              methodology: (domains) => this.methodology.render(domains),
              state: (slices) => this.state.read(userId, slices, now),
            },
          },
        )
      ).output;
    } catch (error) {
      if (!(error instanceof AgentTaskError)) throw error;
      this.logger.warn({ userId, taskId: error.taskId }, 'memória sem curadoria válida');
      return { status: 'SKIPPED', reason: 'NO_VALID_CURATION' };
    }

    const result = await this.memory.apply(
      userId,
      curation.add.map((item) => ({
        kind: item.kind,
        text: item.text,
        importance: item.importance,
        origin: 'CONVERSATION' as const,
      })),
      curation.retire,
    );
    this.logger.info({ event: 'memory_curated', userId, ...result }, 'memória do aluno atualizada');
    return { status: 'CURATED', ...result };
  }
}
