/**
 * `ConfigModule` — global, TASK-0.3.2.
 *
 * Valida `process.env` (+ `.env` local + segredos `*_FILE`) com Zod no boot e **falha
 * rápido** com uma mensagem que nomeia a variável faltante. Nenhum valor sensível tem
 * default; nenhum valor sensível é logado ou reinjetado em `process.env`.
 */
import { Global, Logger, Module } from '@nestjs/common';

import { AppConfigService } from './app-config.service';
import { type AppConfig, envSchema, formatEnvError } from './env.schema';
import { loadEnv } from './load-env';
import { FileSecretError } from './resolve-file-secrets';

/** Erro de boot por configuração inválida. Não carrega valor algum, só nomes. */
export class InvalidConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidConfigurationError';
  }
}

/**
 * Resolve e valida a configuração. Exportada para que os testes (US-0.8) e o futuro
 * runner de migração (US-0.4) reutilizem exatamente o mesmo caminho de validação.
 */
export function buildAppConfig(
  processEnv: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): AppConfig {
  const logger = new Logger('ConfigModule');

  let loaded: ReturnType<typeof loadEnv>;
  try {
    loaded = loadEnv(processEnv, cwd);
  } catch (error) {
    if (error instanceof FileSecretError) {
      // Falha fatal e explícita — jamais fallback silencioso para a env direta.
      throw new InvalidConfigurationError(
        `Falha ao resolver segredo de arquivo.\n  · ${error.message}`,
      );
    }
    throw error;
  }

  for (const warning of loaded.warnings) logger.warn(warning.message);

  const result = envSchema.safeParse(loaded.env);
  if (!result.success) {
    throw new InvalidConfigurationError(formatEnvError(result.error));
  }
  return result.data;
}

let cached: AppConfig | undefined;

/**
 * Configuração do processo, resolvida uma única vez (memoizada).
 *
 * Existe para que o `main.ts` possa validar **antes** do `NestFactory.create` e falhar
 * com uma mensagem limpa: se a validação só acontecesse no provider, o `ExceptionHandler`
 * do Nest imprimiria um stack trace de injeção de dependência por cima da única
 * informação que interessa — o nome da variável que falta.
 */
export function getAppConfig(): AppConfig {
  cached ??= buildAppConfig();
  return cached;
}

/** Apenas para testes: descarta a configuração memoizada. */
export function resetAppConfigCache(): void {
  cached = undefined;
}

@Global()
@Module({
  providers: [
    {
      provide: AppConfigService,
      useFactory: (): AppConfigService => new AppConfigService(getAppConfig()),
    },
  ],
  exports: [AppConfigService],
})
export class ConfigModule {}
