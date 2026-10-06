/**
 * Identificador SQL (nome de role/tabela) que precisa entrar em DDL.
 *
 * `GRANT`/`REVOKE`/`CREATE ...` não aceitam parâmetro ligado: o único controle possível é
 * validar o nome contra uma allowlist estrita antes de interpolar. Aceita só o formato
 * minúsculo, sem aspas, que o Postgres resolve sem ambiguidade (`[a-z_][a-z0-9_]{0,62}`);
 * qualquer outra coisa — aspas, `;`, espaço, `--`, maiúscula — lança antes de montar o SQL.
 *
 * Use SÓ para identificador de configuração/constante. Valor vindo de request vai sempre como
 * parâmetro (`sql\`... ${valor}\``) e nunca passa por aqui.
 */
const SAFE_SQL_IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;

export function sqlIdentifier(name: string): string {
  if (!SAFE_SQL_IDENTIFIER.test(name)) {
    throw new Error(
      `Identificador SQL inválido (esperado ${String(SAFE_SQL_IDENTIFIER)}): ${JSON.stringify(name)}`,
    );
  }
  return name;
}
