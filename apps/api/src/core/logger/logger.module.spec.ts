import 'reflect-metadata';
import pino, { type LoggerOptions } from 'pino';
import { expect, it } from 'vitest';

import { LoggerModule } from './logger.module';

it('remove credenciais antes da saída real do Pino mesmo com LOG_REDACT_PII=false', () => {
  const imports = Reflect.getMetadata('imports', LoggerModule) as {
    providers: {
      provide?: unknown;
      useFactory?: (config: Record<string, unknown>) => { pinoHttp: LoggerOptions };
    }[];
  }[];
  const factory = imports[0]?.providers.find(
    (provider) => provider.provide === 'pino-params',
  )?.useFactory;
  if (!factory) throw new Error('Configuração real do LoggerModule ausente.');
  const options = factory({
    logLevel: 'info',
    isProduction: true,
    appEnv: 'production',
    redactPii: false,
  }).pinoHttp;
  const lines: string[] = [];
  const logger = pino(options, { write: (line) => lines.push(line) });
  const keys = ['sk-proj-', 'sk-ant-api03-', 'sk-', 'gsk_', '$aact_hml_'].map(
    (prefix) => prefix + 'C'.repeat(64),
  );
  const token = 'Z'.repeat(43);

  logger.info({ openai_api_key: keys[0], openaiApiKey: 'opaque-canary-value' }, keys.join(' '));
  logger.error({ err: new Error(keys.join(' ') + ' Bearer ' + token) });
  logger.error(new Error('credential ' + keys[0]));
  logger.info('upstream %j', { deep: { DEEPSEEK_API_KEY: 'opaque-json-canary-value' } });
  for (const action of ['checkout', 'cancel', 'pause', 'resume']) {
    logger.info({
      req: { id: 'canary', method: 'GET', url: `/api/v1/subscription/${action}/${token}` },
    });
  }

  const output = lines.join('');
  for (const secret of [...keys, token, 'opaque-canary-value', 'opaque-json-canary-value']) {
    expect(output).not.toContain(secret);
  }
  expect(lines).toHaveLength(8);
  for (const line of lines) {
    expect(JSON.parse(line)).toMatchObject({ service: 'movivo-api', env: 'production' });
  }
  expect(output).toContain('[REDACTED]');
});
