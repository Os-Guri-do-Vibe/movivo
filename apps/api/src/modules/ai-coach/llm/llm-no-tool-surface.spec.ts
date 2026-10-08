/**
 * Unit ESTRUTURAL — o LLM da MOVIVO não tem superfície de ferramentas (tool/function calling).
 *
 * Prompt injection não se resolve sanitizando entrada: o modelo é um componente NÃO confiável
 * para autorização. Hoje isso é garantido pela estrutura — o contrato do provedor
 * (`ProviderCompleteRequest`) só carrega texto, nenhum adaptador envia `tools`, e toda saída
 * do modelo que vira ação (troca de exercício, ajuste de volume) é uma escolha numa lista
 * FECHADA de ids que o servidor montou para aquele titular e revalida antes de gravar. O
 * `userId` de qualquer operação vem do job/sessão autenticada, nunca de texto do modelo.
 *
 * Se este teste falhar, alguém está dando ferramentas ao modelo. Isso é permitido, mas só
 * junto de uma camada que revalide AUTORIZAÇÃO a cada chamada, com o titular vindo do
 * contexto da sessão (não dos argumentos escolhidos pelo modelo): ver
 * `docs/arquitetura/ARQUITETURA.md` §5 ("LLM é componente não confiável para autorização").
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = join(process.cwd(), 'src');
const TOOL_MARKERS = [
  /\btool_choice\b/,
  /\btool_calls?\b/,
  /\btool_use\b/,
  /\btoolUse\b/,
  /\bfunction_call\b/,
  /\bparallel_tool_calls\b/,
  /['"]tools['"]\s*:|\btools\s*:/,
  /\bmcpServers?\b/,
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) out.push(full);
  }
  return out;
}

/** Remove comentários para o teste olhar só código executável. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('superfície de ferramentas do LLM', () => {
  it('nenhum adaptador de provedor nem o contrato do router declara tools/function calling', () => {
    const files = [
      join(SRC, 'modules', 'ai-coach', 'llm', 'providers.ts'),
      join(SRC, 'modules', 'ai-coach', 'llm', 'llm.types.ts'),
      join(SRC, 'modules', 'ai-coach', 'llm', 'llm-router.service.ts'),
    ];
    const offenders = files.filter((file) => {
      const code = stripComments(readFileSync(file, 'utf8'));
      return TOOL_MARKERS.some((re) => re.test(code));
    });
    expect(
      offenders,
      `tool calling introduzido sem camada de autorização por chamada: ${offenders.join(', ')}`,
    ).toEqual([]);
  });

  it('nenhum módulo do backend monta chamada de tool/MCP para um modelo', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const code = stripComments(readFileSync(file, 'utf8'));
      if (TOOL_MARKERS.some((re) => re.test(code))) offenders.push(file);
    }
    expect(
      offenders,
      `uso de tools/MCP fora do contrato revisado: ${offenders.join(', ')}`,
    ).toEqual([]);
  });
});
