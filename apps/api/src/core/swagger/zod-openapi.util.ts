/**
 * Ponte entre os schemas Zod de `@movivo/shared` (fonte única de verdade da validação —
 * ver `main.ts`, todo `@Body() body: unknown` + `schema.parse(body)`) e a documentação
 * OpenAPI/Swagger.
 *
 * Gerar o `schema` do `@ApiBody`/`@ApiResponse` a partir do MESMO objeto Zod usado na
 * validação (via `z.toJSONSchema`, nativo desde Zod 4) é o que evita a documentação
 * divergir silenciosamente do contrato real — não existe um DTO paralelo para os dois
 * ficarem dessincronizados.
 */
import type { ZodType } from 'zod';
import { z } from 'zod';

/**
 * Shape mínimo que o `@nestjs/swagger` aceita em `@ApiBody`/`@ApiResponse({ schema })` —
 * o pacote não exporta publicamente seu tipo `SchemaObject` (só existe em `dist/interfaces`,
 * fora do `exports` do `package.json`), então tipamos aqui só o suficiente para o uso local.
 */
export type OpenApiSchema = Record<string, unknown>;

/** Converte um schema Zod em JSON Schema (OpenAPI 3.0), pronto para `@ApiBody({ schema })`. */
export function zodSchemaToOpenApi(schema: ZodType): OpenApiSchema {
  return z.toJSONSchema(schema, { target: 'openapi-3.0', unrepresentable: 'any' }) as OpenApiSchema;
}
