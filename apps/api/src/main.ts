/**
 * Bootstrap da API MOVIVO — TASK-0.3.1.
 *
 * `reflect-metadata` precisa ser o **primeiro** import do processo: o NestJS lê a
 * metadata emitida pelos decorators para resolver a injeção de dependência.
 */
import 'reflect-metadata';

import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { APP_VERSION } from '@movivo/shared';
import { Logger as PinoLogger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { AppConfigService, getAppConfig, InvalidConfigurationError } from './core/config';

async function bootstrap(): Promise<void> {
  /*
   * Fail-fast de configuração ANTES de qualquer coisa (TASK-0.3.2). Validar aqui, e não
   * só no provider, é o que garante uma mensagem legível: dentro do `NestFactory.create`
   * o `ExceptionHandler` do Nest empilharia um stack trace de injeção de dependência por
   * cima da única informação útil — o nome da variável que falta. O resultado é
   * memoizado, então o `ConfigModule` reaproveita e não relê os segredos.
   */
  getAppConfig();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // O logger do Nest fica em buffer até o pino assumir, para que nenhuma linha de
    // boot escape do formato JSON estruturado.
    bufferLogs: true,
  });

  app.useLogger(app.get(PinoLogger));
  const config = app.get(AppConfigService);

  // Versionamento de API na URL — regra §12.10. Todo endpoint vive sob /api/v1.
  app.setGlobalPrefix(config.globalPrefix);

  app.useGlobalPipes(
    new ValidationPipe({
      // `whitelist` remove propriedade não declarada no DTO e `forbidNonWhitelisted`
      // rejeita a request que a enviou: mass assignment é o vetor clássico de
      // escalonamento de privilégio (OWASP API3). Nunca relaxar essas duas.
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      // Em produção a mensagem de erro de validação não descreve o DTO — evita dar
      // um mapa da API para quem está sondando, e evita ecoar o valor enviado.
      disableErrorMessages: config.isProduction,
      validationError: { target: false, value: false },
    }),
  );

  // CORS restrito por env. `API_CORS_ORIGINS` é validado no Zod e recusa "*".
  app.enableCors({
    origin: [...config.corsOrigins],
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-correlation-id', 'x-request-id'],
    exposedHeaders: ['x-correlation-id'],
    maxAge: 600,
  });

  // Confia no proxy reverso (Cloudflare/nginx) para IP real e protocolo — necessário
  // para rate limiting por IP e para URLs absolutas corretas atrás de TLS terminado.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  /*
   * Graceful shutdown. Sem isto, um SIGTERM do Docker mata o processo no meio de uma
   * transação ou de um job. Com isto, os hooks `onApplicationShutdown` do Database e
   * do Redis drenam suas conexões — e, a partir da Sprint 3, os workers BullMQ
   * terminam o job em voo antes de sair.
   */
  app.enableShutdownHooks();

  await app.listen(config.httpPort, '0.0.0.0');

  const logger = new Logger('Bootstrap');
  logger.log(
    `MOVIVO API v${APP_VERSION} ouvindo em http://localhost:${config.httpPort}/${config.globalPrefix} ` +
      `(env=${config.appEnv}, tz=${config.timezone})`,
  );
  logger.log(`Health check: http://localhost:${config.httpPort}/${config.globalPrefix}/health`);
}

bootstrap().catch((error: unknown) => {
  /*
   * Fail-fast de configuração (TASK-0.3.2): a mensagem do Zod já nomeia a variável
   * faltante. Vai para stderr sem stack trace porque o stack não ajuda — o que ajuda
   * é o nome da variável. Nenhum valor de configuração é impresso.
   */
  if (error instanceof InvalidConfigurationError) {
    console.error(`\n[movivo-api] ${error.message}\n`);
    process.exit(1);
  }

  console.error('[movivo-api] falha fatal no bootstrap:', error);
  process.exit(1);
});
