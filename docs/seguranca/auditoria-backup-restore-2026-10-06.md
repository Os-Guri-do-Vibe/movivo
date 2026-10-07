# Auditoria — Backup do banco + teste de restore (local e produção)

**Data:** 2026-10-06 · **Responsáveis:** Sato (segurança) e Henrique (plataforma)
**Critério:** o item não é "backup configurado", e sim *backup automático + retenção + cópia isolada + restore testado periodicamente*.
**Contexto:** 1 VPS (Hostinger KVM 2, 100 GB), zero clientes, sem orçamento para storage externo (decisão de 2026-09-24). Cadência semanal aceita pelo Rodrigo para o que tem custo.

## Veredito

Antes: havia **backup**, não havia **restore comprovado** — e a chave que torna os dumps legíveis existia só na VPS. Depois desta auditoria os cinco critérios têm resposta; os dois que seguem abertos são riscos aceitos e declarados abaixo.

## Achados e tratamento

| # | Achado | Risco | Tratamento |
|---|---|---|---|
| 1 | Nenhum restore jamais executado; procedimento da doc nunca exercitado | Alto | `movivo-restore-test.sh` + timer semanal (dom 04:30 BRT). 1ª execução: OK (movivo 49 tabelas/26 com RLS, evolution 37 tabelas, idêntico ao vivo; uploads íntegro) |
| 2 | Teste que nunca reprova não vale nada | Alto | Reprovação comprovada nos 3 cenários: chave errada, dump truncado, backup > 36 h |
| 3 | `backup_encryption_key` e `pgcrypto_key` só na VPS: perda da VPS = dumps ilegíveis e dado de saúde irrecuperável | Crítico | Cópia no Keychain do Mac (`movivo-backup-encryption-key`, `movivo-pgcrypto-key`, conta `movivo-prod`), conferida por hash. **Falta uma cópia com outro fundador** |
| 4 | Dump gravado sem verificação (arquivo truncado só seria descoberto no dia da crise) | Médio | `verify_dump` após cada escrita (decifra + `pg_restore --list`); falha renomeia para `.INVALIDO` e derruba o job |
| 5 | Retenção só de 7 dias: corrupção silenciosa de 8+ dias não tem ponto de retorno | Médio | +4 cópias de domingo em `weekly/` (≈35 dias; ~1 MB cada) |
| 6 | Cópia fora da VPS = só backup semanal da Hostinger (mesmo provedor, disco inteiro, restore nunca testado); snapshot estava expirado | Médio | `pull-offsite.sh` (pull para o Mac, sem as chaves, 35 dias). Backup Hostinger permanece, **sem teste de restore** (substitui a VM inteira) |
| 7 | Sem PITR | Baixo hoje | **Aceito**: RPO ≤ 24 h local / ≤ 7 dias fora da VPS. Gatilho para revisar no runbook |
| 8 | Sem alerta se backup/teste falhar | Médio | **Aberto**: só `systemctl is-failed` e `restore-test.status`. Entra junto com uptime externo |
| 9 | Política de Privacidade tem `[PRAZO DE BACKUP]` em branco | Baixo | Retenção efetiva hoje: até 35 dias. Decisão de Alexandre |

## O que não foi coberto

- **Redis** (filas BullMQ/cache) não entra no backup; não verifiquei se o conteúdo é reconstruível.
- O teste semanal usa contagem de linhas/tabelas/RLS/extensões; **não decifra uma coluna de saúde** com a `pgcrypto_key` para provar que chave e dado combinam.
- Contagem exata de linhas é adequada ao volume atual; com GBs de dados trocar por `reltuples` ou amostragem.

## Frequência (diário vs. semanal)

Mantido o dump **diário** local: custa ~1 MB/dia em 67 GB livres, e passar a semanal pioraria o RPO de 1 para 7 dias sem economizar nada. A cadência semanal vale onde há custo/esforço: cópia fora da VPS, teste de restore e cópias longas.

## Arquivos

`infra/vps/backup/{movivo-backup.sh, movivo-restore-test.{sh,service,timer}, pull-offsite.sh}`, `infra/vps/deploy.sh` (instala os timers), `docs/operacoes/deploy-producao.md` (runbook).
