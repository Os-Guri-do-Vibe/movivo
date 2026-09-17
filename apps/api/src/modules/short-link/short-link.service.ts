/**
 * `ShortLinkService` — gera um código curto para uma URL longa (token de magic link, sessão
 * de renovação de mesociclo), resolvido via `ShortLinkController` (endpoint interno, chamado
 * pelo proxy do `apps/web` — API não é publicamente roteável, ver `pdf/route.ts`).
 *
 * Devolve só o CÓDIGO, não a URL final: quem chama decide o caminho amigável no domínio da
 * marca (`/check-in/<código>`, `/renovacao/<código>`) — a API não sabe, e não deveria saber,
 * qual rota do `apps/web` cada feature usa (regra §12.10 de versionamento não vale para o
 * `apps/web`, que tem seu próprio roteamento de página).
 *
 * Achado 2026-09-12 (pedido do fundador): o link do diário de treino manda um token opaco de
 * 43 caracteres na URL — feio, extenso e com cara de phishing numa mensagem de WhatsApp.
 * WhatsApp não tem sintaxe de hyperlink com texto âncora (nem no protocolo oficial, nem no
 * Baileys/EvolutionAPI que usamos hoje) — o texto clicável É a URL. Encurtar a URL em si é o
 * único jeito real de atacar o problema. Tentativa anterior expunha `api.movivo.com/api/v1/l/…`
 * direto pro navegador do aluno — corrigido porque a API não é alcançável de fora (mesmo
 * problema que `protocolo/[token]/pdf/route.ts` já resolve pra o PDF): o link visível
 * precisa sempre resolver no domínio do `apps/web`.
 *
 * **Trade-off de segurança, deliberado:** ao contrário de `workout_access_tokens` (só guarda o
 * hash SHA-256, nunca o token cru — Sato, defesa em profundidade contra vazamento só-de-banco),
 * `short_links.target_url` guarda a URL final EM CLARO, token incluído. Aceitável porque
 * (1) esse mesmo token já trafega em claro pela rede da EvolutionAPI/WhatsApp assim que a
 * mensagem é enviada — o hash-only do token original defende contra comprometimento SÓ do
 * banco, não contra a rede, e este alias não piora esse segundo vetor; (2) a linha expira
 * junto com o recurso que aponta (mesmo `expiresAt` de quem chama `create()`); (3) não é
 * dado de titular (sem `user_id`), sem RLS — mesmo padrão de tabela de bootstrap pré-auth de
 * `workout_access_tokens`.
 *
 * **Nunca de uso único** — `resolve()` não marca nada como consumido. O cliente WhatsApp do
 * destinatário faz um GET passivo no link pra montar a prévia (thumbnail) assim que a
 * mensagem chega; um alias de uso único seria queimado por essa prévia antes do aluno tocar
 * de verdade. Quem precisa ser de uso único (o magic token em si) já impõe isso na própria
 * camada — este alias só resolve, sempre.
 */
import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { and, eq, gt } from 'drizzle-orm';

import { shortLinks } from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';

/** Sem 0/O/1/l/I — evita confusão visual quando alguém precisa digitar o código à mão. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const CODE_LENGTH = 8;
const MAX_CREATE_ATTEMPTS = 5;

function randomCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let code = '';
  for (const byte of bytes) {
    code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  }
  return code;
}

@Injectable()
export class ShortLinkService {
  constructor(private readonly db: TenantDatabase) {}

  /** Cria o alias e devolve só o código — quem chama monta a URL amigável final. */
  async create(targetUrl: string, expiresAt: Date): Promise<string> {
    for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt += 1) {
      const code = randomCode();
      const inserted = await this.db.runAsSystem((tx) =>
        tx
          .insert(shortLinks)
          .values({ code, targetUrl, expiresAt })
          .onConflictDoNothing({ target: shortLinks.code })
          .returning({ code: shortLinks.code }),
      );
      if (inserted[0]) return inserted[0].code;
    }
    // Colisão de 8 caracteres num alfabeto de 58 é ~1 em 10^14 — 5 tentativas seguidas
    // batendo nisso indica o gerador de aleatoriedade quebrado, não má sorte.
    throw new Error(
      `short-link: falha ao gerar código único após ${MAX_CREATE_ATTEMPTS} tentativas`,
    );
  }

  /** `null` = código inexistente ou expirado — o controller trata os dois como 410. */
  async resolve(code: string): Promise<string | null> {
    const [row] = await this.db.runAsSystem((tx) =>
      tx
        .select({ targetUrl: shortLinks.targetUrl })
        .from(shortLinks)
        .where(and(eq(shortLinks.code, code), gt(shortLinks.expiresAt, new Date())))
        .limit(1),
    );
    return row?.targetUrl ?? null;
  }
}
