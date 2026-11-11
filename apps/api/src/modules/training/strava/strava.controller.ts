/** Rotas públicas do Strava: início do OAuth, volta do OAuth e webhook de atividades. */
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Response } from 'express';
import { z } from 'zod';

import { STRAVA_PAGES, StravaService } from './strava.service';

const STATE = /^[A-Za-z0-9_-]{43}$/;
const callbackQuerySchema = z.object({
  state: z.string().regex(STATE),
  code: z.string().max(200).optional(),
  scope: z.string().max(200).optional(),
  error: z.string().max(100).optional(),
});

@ApiExcludeController()
@Controller('wearables/strava')
@UseGuards(ThrottlerGuard)
export class StravaController {
  constructor(private readonly strava: StravaService) {}

  @Get('connect/:state')
  @Header('Referrer-Policy', 'no-referrer')
  @Header('Cache-Control', 'no-store')
  async connect(@Param('state') state: string, @Res() res: Response): Promise<void> {
    const url = STATE.test(state) ? await this.strava.authorizeUrl(state) : null;
    if (url) return res.redirect(302, url);
    res.status(404).type('html').send(STRAVA_PAGES.expired);
  }

  @Get('callback')
  @Header('Referrer-Policy', 'no-referrer')
  @Header('Cache-Control', 'no-store')
  async callback(@Query() query: unknown, @Res() res: Response): Promise<void> {
    const parsed = callbackQuerySchema.safeParse(query);
    const result = parsed.success ? await this.strava.callback(parsed.data) : 'expired';
    res
      .status(result === 'connected' ? 200 : 400)
      .type('html')
      .send(STRAVA_PAGES[result]);
  }

  /** Verificação da assinatura do webhook, feita uma vez pelo Strava. */
  @Get('webhook')
  challenge(@Query() query: Record<string, unknown>): { 'hub.challenge': string } {
    const challenge = this.strava.challenge(
      query['hub.mode'],
      query['hub.verify_token'],
      query['hub.challenge'],
    );
    if (!challenge) throw new ForbiddenException();
    return { 'hub.challenge': challenge };
  }

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async webhook(@Body() body: unknown): Promise<{ ok: true }> {
    await this.strava.receive(body);
    return { ok: true };
  }
}
