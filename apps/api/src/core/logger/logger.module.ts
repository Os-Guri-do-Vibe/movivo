/**
 * `LoggerModule` — TASK-0.3.5.
 *
 * Log estruturado em JSON (pino), um `correlationId` por request propagado em todo
 * log daquela request, e redação de PII ativada por construção — ver
 * `redaction.util.ts` para o porquê (LGPD Art. 11, Sato §9).
 *
 * O correlation id vem do header `x-request-id`/`x-correlation-id` quando o cliente
 * (ou o Cloudflare, ou o webhook da AraraHQ) já mandou um; senão é gerado. Ele volta
 * no header da resposta para que o suporte consiga cruzar um relato de usuário com o
 * log sem precisar do telefone dele.
 */
import { randomUUID } from 'node:crypto';

import { Global, Module, RequestMethod } from '@nestjs/common';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { AppConfigService } from '../config';
import { REDACT_PATHS, REDACTED, redactPii } from './redaction.util';

export const CORRELATION_ID_HEADER = 'x-correlation-id';
const REQUEST_ID_HEADER = 'x-request-id';

function headerValue(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

@Global()
@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        // Rota explícita no formato do path-to-regexp v8 (Express 5 / Nest 11). O
        // default do nestjs-pino ainda é `'*'`, que dispara um aviso de conversão
        // legada em todo boot; declarar `{*path}` elimina o ruído e deixa claro que
        // o middleware de log cobre tudo.
        forRoutes: [{ path: '{*path}', method: RequestMethod.ALL }],
        pinoHttp: {
          level: config.logLevel,
          // Em produção nunca há pretty-print: o coletor (Loki) quer NDJSON puro.
          transport: config.isProduction
            ? undefined
            : {
                target: 'pino-pretty',
                options: { singleLine: true, translateTime: 'SYS:HH:MM:ss' },
              },
          base: { service: 'movivo-api', env: config.appEnv },
          // Redação estrutural: o pino substitui o valor ANTES de serializar, então o
          // valor em claro nunca chega ao buffer de saída nem ao transport.
          redact: config.redactPii ? { paths: [...REDACT_PATHS], censor: REDACTED } : undefined,
          genReqId: (request: IncomingMessage, response: ServerResponse): string => {
            const incoming =
              headerValue(request, CORRELATION_ID_HEADER) ??
              headerValue(request, REQUEST_ID_HEADER);
            // Header de cliente é entrada não confiável: limitamos tamanho e charset
            // para não permitir injeção de conteúdo na linha de log.
            const correlationId =
              incoming && /^[\w.:-]{1,128}$/.test(incoming) ? incoming : randomUUID();
            response.setHeader(CORRELATION_ID_HEADER, correlationId);
            return correlationId;
          },
          customProps: (request: IncomingMessage) => ({
            correlationId: (request as IncomingMessage & { id?: string }).id,
          }),
          /*
           * Serializers minimalistas: só o que é necessário para operar.
           *
           * O corpo da request NUNCA é logado — na MOVIVO ele carrega anamnese e
           * telefone. E a URL é dividida em `path` + `queryKeys`: o **valor** de um
           * query param jamais entra no log. Isto não é paranoia — foi observado na
           * validação desta US: `GET /api/v1/usuarios?phone=%2B5511987654321` gravava
           * o telefone em claro na linha de log, mesmo com toda a redação estrutural
           * ativa, porque a PII estava dentro de uma única string de URL.
           */
          serializers: {
            req: (request: { id: unknown; method: string; url: string }) => {
              const [rawPath = '', rawQuery] = request.url.split('?');
              const queryKeys = rawQuery
                ? [...new URLSearchParams(rawQuery).keys()].sort()
                : undefined;
              return {
                id: request.id,
                method: request.method,
                path: redactPii(decodeURIComponent(rawPath)),
                ...(queryKeys?.length ? { queryKeys } : {}),
              };
            },
            res: (response: { statusCode: number }) => ({ statusCode: response.statusCode }),
          },
          autoLogging: {
            ignore: (request: IncomingMessage) => request.url?.endsWith('/health') === true,
          },
        },
      }),
    }),
  ],
  exports: [PinoLoggerModule],
})
export class LoggerModule {}
