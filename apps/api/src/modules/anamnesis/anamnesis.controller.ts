/**
 * Contratos REST do onboarding v2 (Sprint 6 — substitui os da anamnese v1).
 *
 * Fluxo **não autenticado**: a autorização é o token opaco da sessão (na URL, path
 * param — nunca query string, Sato §8.1). Cada resposta leva `Referrer-Policy:
 * no-referrer` para o token não vazar no header `Referer` de navegação. O token no
 * path é redigido do log pela camada de logger (`redaction.util`).
 *
 * Rate limit `/anamnesis/*` = 60 req/min por IP (Rafael §1217) via `ThrottlerGuard`;
 * os endpoints de código de verificação têm limites próprios **de negócio** no serviço
 * (por sessão e por número), porque limite por IP não protege quem troca de IP.
 *
 * Validação de entrada por Zod compartilhado (`@movivo/shared`) — fonte única com o
 * frontend. O `PATCH .../block/{n}` da v1 **não existe mais** (D1).
 */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  ONBOARDING_STEP_SCHEMAS,
  onboardingStepNumberSchema,
  type OnboardingStepNumber,
  sendPhoneCodeSchema,
  startAnamnesisSchema,
  verifyPhoneCodeSchema,
} from '@movivo/shared';

import { zodSchemaToOpenApi } from '../../core/swagger/zod-openapi.util';
import { parseBody } from '../../core/validation/strict-input';
import { AnamnesisService } from './anamnesis.service';

const TOKEN_PARAM = {
  name: 'token',
  description:
    'Token opaco da sessão de anamnese (autorização do fluxo não autenticado — nunca um userId/sessionId).',
} as const;

@ApiTags('Anamnese')
@Controller('anamnesis')
@UseGuards(ThrottlerGuard)
export class AnamnesisController {
  constructor(private readonly anamnesis: AnamnesisService) {}

  @Post('start')
  @Header('Referrer-Policy', 'no-referrer')
  @ApiOperation({
    summary: 'Inicia uma sessão de anamnese',
    description:
      'Endpoint público (não autenticado) chamado pela landing page. Cria a sessão e retorna o token opaco usado em todas as demais rotas deste módulo.',
  })
  @ApiBody({ schema: zodSchemaToOpenApi(startAnamnesisSchema) })
  @ApiResponse({ status: 201, description: 'Sessão criada — retorna o token da sessão.' })
  @ApiResponse({ status: 400, description: 'Corpo fora do schema.' })
  async start(@Body() body: unknown) {
    const input = parseBody(startAnamnesisSchema, body ?? {});
    return this.anamnesis.start(input);
  }

  @Get('session/:token')
  @Header('Referrer-Policy', 'no-referrer')
  @ApiOperation({
    summary: 'Consulta o estado da sessão',
    description: 'Retorna o progresso salvo (etapas já preenchidas) para retomar o formulário.',
  })
  @ApiParam(TOKEN_PARAM)
  @ApiResponse({ status: 200, description: 'Estado atual da sessão.' })
  @ApiResponse({ status: 404, description: 'Token inexistente ou expirado.' })
  async get(@Param('token') token: string) {
    return this.anamnesis.getByToken(token);
  }

  /** Salvamento de progresso por ETAPA (1..8). O schema de cada etapa é aplicado no serviço. */
  @Patch('session/:token/step/:n')
  @Header('Referrer-Policy', 'no-referrer')
  @ApiOperation({
    summary: 'Salva uma etapa da anamnese (1 a 8)',
    description:
      '1 Cadastro · 2 Objetivos · 3 Modalidades · 4 Rotina · 5 Preferências e saúde · 6 PAR-Q · ' +
      '7 Alimentação · 8 Corpo (opcional). Saúde, alergias e todo texto livre são guardados só ' +
      'cifrados e nunca voltam na leitura da sessão.',
  })
  @ApiParam(TOKEN_PARAM)
  @ApiParam({
    name: 'n',
    enum: ['1', '2', '3', '4', '5', '6', '7', '8'],
    description: 'Número da etapa.',
  })
  @ApiBody({
    schema: {
      oneOf: Object.values(ONBOARDING_STEP_SCHEMAS).map((schema) => zodSchemaToOpenApi(schema)),
    },
  })
  @ApiResponse({ status: 200, description: 'Etapa salva.' })
  @ApiResponse({ status: 400, description: 'Etapa fora de 1..8 ou corpo fora do schema da etapa.' })
  @ApiResponse({ status: 404, description: 'Token inexistente.' })
  async patchStep(@Param('token') token: string, @Param('n') n: string, @Body() body: unknown) {
    return this.anamnesis.patchStep(token, this.parseStepNumber(n), body);
  }

  /**
   * Envia o código de verificação pelo WhatsApp. Resposta idêntica para envio novo e
   * para reenvio em cooldown (`sent: false`): a UI já mostra o contador, e diferenciar
   * dá ao atacante um sinal de estado que ele não precisa ter.
   */
  @Post('session/:token/phone/send-code')
  @HttpCode(HttpStatus.OK)
  @Header('Referrer-Policy', 'no-referrer')
  @ApiOperation({
    summary: 'Envia o código de verificação por WhatsApp',
    description:
      'Resposta idêntica (`sent: false`) para envio novo e para reenvio em cooldown, para não vazar estado interno a um atacante.',
  })
  @ApiParam(TOKEN_PARAM)
  @ApiBody({ schema: zodSchemaToOpenApi(sendPhoneCodeSchema) })
  @ApiResponse({ status: 200, description: 'Código enviado (ou reenvio ainda em cooldown).' })
  @ApiResponse({ status: 400, description: 'Telefone fora do formato E.164.' })
  @ApiResponse({ status: 429, description: 'Limite de envio por sessão/número excedido.' })
  async sendPhoneCode(@Param('token') token: string, @Body() body: unknown) {
    const { phoneNumber } = parseBody(sendPhoneCodeSchema, body);
    return this.anamnesis.sendPhoneCode(token, phoneNumber);
  }

  @Post('session/:token/phone/verify')
  @HttpCode(HttpStatus.OK)
  @Header('Referrer-Policy', 'no-referrer')
  @ApiOperation({ summary: 'Verifica o código recebido por WhatsApp' })
  @ApiParam(TOKEN_PARAM)
  @ApiBody({ schema: zodSchemaToOpenApi(verifyPhoneCodeSchema) })
  @ApiResponse({ status: 200, description: 'Código válido — telefone confirmado na sessão.' })
  @ApiResponse({ status: 400, description: 'Código incorreto ou expirado.' })
  @ApiResponse({ status: 429, description: 'Limite de tentativas excedido.' })
  async verifyPhoneCode(@Param('token') token: string, @Body() body: unknown) {
    const { code } = parseBody(verifyPhoneCodeSchema, body);
    return this.anamnesis.verifyPhoneCode(token, code);
  }

  @Post('session/:token/submit')
  @HttpCode(HttpStatus.OK)
  @Header('Referrer-Policy', 'no-referrer')
  @ApiOperation({
    summary: 'Envia a anamnese completa',
    description:
      'Fecha a sessão, dispara a criação da conta do aluno e enfileira a geração do protocolo inicial. Requer as 3 etapas e o telefone verificado.',
  })
  @ApiParam(TOKEN_PARAM)
  @ApiResponse({
    status: 200,
    description:
      'Anamnese enviada — `READY` (protocolo em geração) ou `PENDING_REVIEW` (encaminhado ao profissional CREF).',
  })
  @ApiResponse({
    status: 400,
    description: 'Sessão incompleta (etapa faltante ou telefone não verificado).',
  })
  @ApiResponse({ status: 404, description: 'Token inexistente ou expirado.' })
  async submit(@Param('token') token: string) {
    return this.anamnesis.submit(token);
  }

  private parseStepNumber(raw: string): OnboardingStepNumber {
    const parsed = onboardingStepNumberSchema.safeParse(Number(raw));
    if (!/^[1-8]$/.test(raw) || !parsed.success) {
      throw new BadRequestException('Etapa inválida: use de 1 a 8.');
    }
    return parsed.data as OnboardingStepNumber;
  }
}
