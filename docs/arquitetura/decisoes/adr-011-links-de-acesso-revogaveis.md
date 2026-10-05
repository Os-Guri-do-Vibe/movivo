# ADR-011 — Credenciais revogáveis para links de acesso

**Data:** 2026-10-05 · **Status:** implementada e ativada em produção em 2026-10-05.

## Contexto

A auditoria confirmou links de checkout válidos e um identificador de protocolo em logs privados. Usar a PK do protocolo ou do titular como credencial impede revogação sem alterar identidades persistentes. Checkout stateless derivado de `PGCRYPTO_KEY` também não permite revogação individual e acopla autenticação à cifra de saúde. A denylist Nginx e a supressão de erros foram contenções, não a solução permanente.

## Decisão

- Protocolo, checkout e portal de assinatura usam tokens aleatórios de 32 bytes, distintos dos IDs. A tabela `access_link_tokens` guarda somente SHA-256, titular, recurso, finalidade, expiração e revogação. RLS ENABLE/FORCE segue o runner de migração existente.
- Toda leitura, PDF e mutação consulta o estado autoritativo no banco, incluindo a finalidade. Renovar substitui atomicamente o hash anterior no mesmo recurso; revogar não altera PKs ou a chave dos dados de saúde. Banco indisponível não autoriza acesso.
- Protocolo tem validade de 120 dias; portal, 90 dias; checkout, 72 horas. Nenhum token é válido para outra finalidade. Leituras do protocolo usam também o tenant autenticado pelo link.
- Aliases têm 24 caracteres aleatórios sem viés (~140 bits). Código é persistido como SHA-256 e URL de destino é cifrada com o helper pgcrypto existente, cuja chave continua exclusivamente no runtime. Códigos antigos são expirados e convertidos em hashes; destinos são cifrados pela migração sem imprimir seus valores.
- URLs e estruturas das respostas v1 permanecem. **Exceção de segurança à janela de dual-support de 90 dias (§12.10):** credenciais antigas por ID, checkout cifrado e aliases de baixa entropia são recusadas imediatamente. Manter sua aceitação perpetuaria uma exposição confirmada. A instrução do usuário de 2026-10-05 exige a correção definitiva; nenhum dado de treino ou pagamento é apagado.
- Links novos são emitidos pelos fluxos existentes; a auditoria não envia mensagens aos alunos. Links antigos precisam ser substituídos. A operação pode revogar uma credencial por sua linha/hash, ou todas de um titular (`AccessLinkService.revokeForUser`).
- Reverter para imagens que não tenham a implementação revogável é proibido pelo gate do deploy. Rollback de uma correção de segurança não deve reabrir IDs como credenciais.

## Validação

`node scripts/verify-access-links.mjs`, com `SECURITY_TEST_DATABASE_URL` apontando exclusivamente para um banco descartável `movivo_security_test_*`, exercita as classes reais contra PostgreSQL: RLS, hash-only, finalidade, expiração, renovação, revogação, isolamento entre titulares, anonimização e aliases cifrados. Testes dos controllers recusam IDs legados antes de ler dados ou executar mutações.

A imagem candidata foi validada também contra restauração isolada do backup cifrado de produção: runner completo, 26 tabelas com RLS ENABLE/FORCE e 20 destinos preservados, com igualdade conferida após decifragem sem imprimir valores. Em produção, as 13 requisições diretas à API com credenciais legadas de checkout, protocolo/PDF e portal (leitura/cancelamento/pausa/retomada) retornaram 404, sem depender do bloqueio Nginx.

## Fontes Consultadas

- https://nodejs.org/api/crypto.html — CSPRNG e SHA-256.
- https://www.postgresql.org/docs/18/ddl-rowsecurity.html — políticas e FORCE ROW LEVEL SECURITY.
- https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html — ciclo de vida e revogação de credenciais.
