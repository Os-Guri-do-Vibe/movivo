import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import {
  finishWorkoutSchema,
  saveWorkoutSetsSchema,
  uuidSchema,
  workoutDateSchema,
} from '@movivo/shared';
import { z } from 'zod';

import { WorkoutAccessService } from './workout-access.service';
import { WorkoutJournalService } from './workout-journal.service';

const exchangeSchema = z.object({ token: z.string().min(40).max(100) });

@Controller('workouts')
@UseGuards(ThrottlerGuard)
export class WorkoutController {
  constructor(
    private readonly access: WorkoutAccessService,
    private readonly journalService: WorkoutJournalService,
  ) {}

  @Post('access/exchange')
  @Header('Cache-Control', 'private, no-store')
  @Header('Referrer-Policy', 'no-referrer')
  async exchange(@Body() raw: unknown) {
    const { token } = exchangeSchema.parse(raw);
    return { sessionToken: await this.access.exchange(token) };
  }

  @Get('journal')
  @Header('Cache-Control', 'private, no-store')
  async journal(@Headers('authorization') authorization?: string, @Query('date') date?: string) {
    const userId = await this.access.requireUser(authorization);
    return this.journalService.journal(
      userId,
      date === undefined ? undefined : workoutDateSchema.parse(date),
    );
  }

  @Post('sessions/:id/start')
  @Header('Cache-Control', 'private, no-store')
  async start(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') rawId: string,
  ) {
    const userId = await this.access.requireUser(authorization);
    await this.journalService.start(userId, uuidSchema.parse(rawId));
    return { ok: true };
  }

  @Patch('sessions/:id/sets')
  @Header('Cache-Control', 'private, no-store')
  async sets(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') rawId: string,
    @Body() raw: unknown,
  ) {
    const userId = await this.access.requireUser(authorization);
    const body = saveWorkoutSetsSchema.parse(raw);
    await this.journalService.saveSets(userId, uuidSchema.parse(rawId), body.entries);
    return { ok: true };
  }

  @Post('sessions/:id/finish')
  @Header('Cache-Control', 'private, no-store')
  async finish(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') rawId: string,
    @Body() raw: unknown,
  ) {
    const userId = await this.access.requireUser(authorization);
    await this.journalService.finish(
      userId,
      uuidSchema.parse(rawId),
      finishWorkoutSchema.parse(raw),
    );
    return { ok: true };
  }
}
