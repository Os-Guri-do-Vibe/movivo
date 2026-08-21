# Runbook — Base de Conhecimento da IA

**Responsável:** Platform Engineering / SRE  
**Data:** 2026-08-20  
**Escopo:** ingestão, processamento, recuperação e publicação de conhecimento no MVP

## Resumo executivo

O MVP reutiliza PostgreSQL/PGVector, Redis Sentinel, BullMQ, DLQ, logs estruturados e o processo da API que já existem. A ingestão roda na fila `knowledge-processing`, é idempotente e mantém o original em quarentena no PostgreSQL. Não foi acrescentado MinIO, ClamAV ou Apache Tika porque nenhum adaptador de aplicação consome esses serviços hoje; subi-los criaria custo e falsa sensação de proteção.

O gate operacional permanece **fail-closed**: somente `text/plain` e `text/markdown`, até 512 KiB. PDF, DOC, DOCX, XLS, XLSX, JPG e PNG continuam bloqueados até todos os controles da seção “Gate para formatos complexos” serem aprovados por Sato, Mariana, Leonardo e Henrique.

## Contexto da infraestrutura

O caminho operacional é:

```text
upload autenticado
  -> original em quarentena no PostgreSQL (SHA-256 + retenção)
  -> BullMQ `knowledge-processing` no Redis/Sentinel
  -> validação, normalização e chunking idempotentes
  -> revisão humana CREF
  -> embedding/PGVector
  -> publicação ou DLQ
```

O worker permanece no mesmo _deployment unit_ da API durante o MVP. Isso reaproveita o shutdown gracioso e a descoberta do master Redis já implementados. Separar API e worker passa a ser necessário quando o processamento disputar CPU/memória com HTTP ou quando a fila exceder os limites de alerta deste documento.

## Arquitetura recomendada

- PostgreSQL é a fonte de verdade de metadados, versões, revisão, auditoria, original em quarentena e chunks publicados.
- PGVector continua sendo o armazenamento vetorial; não há justificativa de escala para um segundo banco.
- Redis/Sentinel sustenta a fila, retries e DLQ; `maxmemory-policy=noeviction` é obrigatório.
- O payload da fila carrega somente identificadores opacos, hash/correlation ID e versão do pipeline. Conteúdo e filename não entram no Redis nem em logs.
- O job deve poder ser repetido sem duplicar chunks, revisões ou publicações. Um retry retoma pelo estado persistido, nunca por suposição em memória.

## Provisionamento e containers

Nenhum serviço novo foi ligado no `docker-compose.yml`. O stack atual já oferece as dependências utilizadas pelo código e permanece com portas somente em `127.0.0.1`, `no-new-privileges`, logs rotacionados, limites de recurso e healthchecks.

Quando o gate de formatos complexos for satisfeito, parser, antimalware e object storage devem entrar por um profile explícito `knowledge-complex`, nunca no profile padrão. Requisitos mínimos:

- imagens fixadas por versão e digest, com varredura de CVE antes da promoção;
- rede interna exclusiva, sem porta de ClamAV/Tika/objeto publicada no host;
- usuário não-root, `cap_drop: [ALL]`, `no-new-privileges`, filesystem read-only e diretório temporário com quota;
- CPU, memória, PIDs, tamanho, tempo e concorrência limitados; timeout mata o processo de extração;
- healthcheck de processo **e** readiness funcional (assinaturas antivírus recentes e parse de arquivo canário);
- egress negado ao parser. Atualização de assinaturas do antimalware usa caminho separado e auditado;
- OCR em português somente após imagem derivada reproduzível e teste de precisão.

## Estratégia de CI/CD

O check estático é executável com:

```bash
pnpm run infra:knowledge:verify
```

Ele falha se formatos complexos forem habilitados, se a allowlist sair de TXT/Markdown, se o limite ultrapassar 512 KiB, se a fila não estiver registrada ou se o boot não validar a feature flag. Com o stack local no ar, execute também:

```bash
pnpm run infra:knowledge:verify:runtime
```

Antes de produção, o pipeline deve ainda rodar corpus malicioso, arquivo truncado, _zip bomb_, MIME divergente, timeout de parser, indisponibilidade de Redis/PostgreSQL, retry idempotente, DLQ e restauração do backup. O deploy é bloqueado se qualquer caso falhar.

## Estratégia de observabilidade

Enquanto a exportação OpenTelemetry não estiver ligada, logs estruturados por `correlationId`, eventos persistidos e contadores BullMQ são a fonte operacional. Para ver contadores sem ler payload:

```bash
pnpm run infra:knowledge:status
```

Contrato de telemetria para produção:

| Sinal | Atributos permitidos | Alerta |
|---|---|---|
| `knowledge.ingestion.duration` | `stage`, `mime`, `outcome`, `pipeline_version` | p95 > 60 s por 15 min |
| `knowledge.queue.depth` | `state` | `waiting > 20` por 10 min |
| `knowledge.queue.oldest_age` | nenhum | > 5 min aviso; > 15 min crítico |
| `knowledge.jobs.terminal_failure` | `stage`, `error_code` | 1 ou mais em 15 min |
| `knowledge.documents.published` | `category` | ausência inesperada é evento de produto, não page |
| `knowledge.antivirus.signature_age` | `engine_version` | > 24 h bloqueia ingestão complexa |

Nunca registrar texto extraído, título, nome do arquivo, URL de origem, payload de job, prompt ou dado pessoal em log, métrica, trace ou alerta. IDs de documento também ficam fora de métricas; use-os apenas em log interno com acesso restrito quando indispensável.

SLO inicial: 99% dos TXT/Markdown válidos chegam a `READY_FOR_REVIEW` em até 5 minutos; zero publicação sem aprovação CREF; zero job terminal silencioso.

## Estratégia de segurança operacional

- As três configurações normativas são:

  ```dotenv
  KNOWLEDGE_COMPLEX_FORMATS_ENABLED=false
  KNOWLEDGE_ALLOWED_MIME_TYPES=text/plain,text/markdown
  KNOWLEDGE_UPLOAD_MAX_BYTES=524288
  ```

- A flag não é mecanismo de autorização. Backend continua validando extensão, MIME, assinatura, tamanho, RBAC e estado do workflow.
- Original em quarentena nunca é recuperado pelo RAG; somente chunks de versão publicada e ativa entram em recuperação.
- ClamAV por TCP não oferece proteção de transporte; quando adotado, fica em rede interna dedicada e recebe `INSTREAM` com teto igual ao upload.
- O parser trata todo arquivo como hostil. Não recebe segredo, credencial de cloud, acesso ao Docker socket, banco ou internet.
- A habilitação de formatos complexos exige decisão registrada, imagem/digest, SBOM, relatório SCA e aprovação de segurança.

## Estratégia de backup e recuperação

No MVP, o backup cifrado do PostgreSQL inclui metadados, workflow, auditoria, blobs ainda retidos, chunks e vetores. O restore precisa preservar hashes e IDs para que retries não dupliquem publicações.

- executar backup cifrado diário e teste de restore mensal em ambiente isolado;
- manter cópia imutável/WORM fora do host primário;
- validar após restore: hash da metodologia publicada, contagem por status, integridade da cadeia de auditoria, chunks por documento e fila/DLQ;
- não reprocessar automaticamente toda a base após restore. Primeiro comparar a versão do parser, chunker e embedding; reindexar por comando auditado.

Quando houver object storage, habilitar versionamento antes de object lock, criptografia gerenciada, lifecycle coerente com a retenção e credenciais distintas para escrever em quarentena e ler objetos aprovados.

## Estratégia de escalabilidade e alta disponibilidade

O worker fica no processo da API enquanto `waiting <= 20`, idade do job p95 < 5 min e CPU sustentada < 70%. Ao romper qualquer teto por 15 minutos:

1. separar o worker em processo/container com a mesma imagem e comando dedicado;
2. manter uma única fila e idempotência no banco;
3. escalar concorrência gradualmente, limitado por embedding e conexões do PgBouncer;
4. só depois considerar HPA/Kubernetes, conforme os gates de escala da arquitetura geral.

Falha de Redis impede novos processamentos, mas não deve retirar conhecimento já publicado. Falha do worker deixa documentos em estado recuperável; falha do RAG deve degradar para o motor determinístico e regras L0, nunca para conhecimento ainda não aprovado.

## Impacto em custos (FinOps)

O caminho atual não cria serviços nem dependências pagas. Armazenar arquivos de até 512 KiB no PostgreSQL é aceitável para o volume do MVP e evita operar três serviços ociosos. Medir mensalmente bytes em blobs, chunks por documento, CPU do worker, chamadas de embedding e custo por documento publicado.

Migrar para object storage quando blobs superarem 5 GB, backup/restore do banco for materialmente afetado ou arquivos complexos forem aprovados. O gatilho é operacional, não estético.

## Riscos e trade-offs

| Risco | Estado | Mitigação |
|---|---|---|
| PDF/DOCX/XLSX/imagem não suportado | Aceito no MVP | bloqueio explícito e gate abaixo |
| Worker disputa recurso com HTTP | Monitorado | separar deployment ao romper threshold |
| Blob aumenta backup PostgreSQL | Baixo com 512 KiB | retenção + gatilho de 5 GB |
| DLQ apenas logada | Aberto antes de produção | alerta Sentry e tarefa operacional obrigatórios |
| Telemetria OTEL ainda não exportada | Aberto antes de produção | implementar contrato de sinais acima |

## Gate para formatos complexos

`KNOWLEDGE_COMPLEX_FORMATS_ENABLED=true` somente pode chegar a staging depois de todos os itens:

- [ ] upload `multipart/form-data` em streaming, com limite aplicado antes de alocar o arquivo inteiro;
- [ ] extensão, MIME declarado e _magic bytes_ concordam; arquivos cifrados e archives aninhados são recusados;
- [ ] object storage privado com namespace de quarentena, criptografia, versionamento, lifecycle e IAM mínimo;
- [ ] ClamAV com assinatura < 24 h, `INSTREAM`, timeout, limite de tamanho e falha fechada;
- [ ] Tika/OCR isolado, sem egress/segredos, com limites de CPU/memória/PIDs/tempo e extração determinística;
- [ ] CDR ou sanitização para formatos ativos quando aplicável;
- [ ] corpus adversarial e _zip bomb_ aprovados por Mariana;
- [ ] threat model e imagens/digests aprovados por Sato;
- [ ] restore, purge e reindexação exercitados em staging;
- [ ] métricas, traces, alertas e DLQ acionável em produção;
- [ ] rollback comprovado: voltar a `false` interrompe novos complexos sem afetar os textos publicados.

Até lá, o verificador operacional falha deliberadamente se a flag for ativada.

## Checklist operacional

### Antes do deploy

- [ ] `pnpm run infra:knowledge:verify` verde.
- [ ] testes unitários, integração, SAST, SCA e secret scan verdes.
- [ ] migração aplicada com backup prévio.
- [ ] worker e API usam a mesma versão da imagem/código.
- [ ] nenhuma mudança na allowlist sem aprovação Sato/Mariana.

### Depois do deploy

- [ ] `/health` prova PostgreSQL e Redis.
- [ ] upload canário TXT atravessa fila, revisão, indexação e publicação.
- [ ] retry do mesmo job não duplica chunks.
- [ ] `pnpm run infra:knowledge:status` não mostra fila presa nem DLQ.
- [ ] rollback para a metodologia anterior cria evento/versão auditável.

## Plano de implementação

1. MVP: TXT/Markdown, fila BullMQ, PostgreSQL/PGVector, auditoria, retries, DLQ e check operacional.
2. Produção: exportador OpenTelemetry, dashboards, alertas Sentry e tarefa manual para DLQ.
3. Gate complexo: object storage + antimalware + parser isolado em staging.
4. Escala: separar worker e aplicar autoscaling somente com dados de fila/CPU.

## Próximos passos

1. Mariana automatiza o gate adversarial e o teste de idempotência.
2. Sato aprova o threat model e os digests antes de qualquer formato binário.
3. Henrique liga OTEL/Sentry e prova alertas antes do go-live.
4. Leonardo implementa adapters de object storage/scan/parser apenas quando o gate virar escopo aprovado.

## Fontes consultadas

- Docker Compose — profiles: https://docs.docker.com/reference/compose-file/profiles/
- Docker Compose — ordem e readiness por healthcheck: https://docs.docker.com/compose/how-tos/startup-order/
- ClamAV — imagem oficial, execução sem root e healthcheck: https://docs.clamav.net/manual/Installing/Docker.html
- ClamAV — protocolo `clamd`, `INSTREAM` e limites: https://docs.clamav.net/manual/Usage/ClamdProtocol.html
- Apache Tika Docker — imagens minimal/full e OCR: https://github.com/apache/tika-docker
- BullMQ — jobs idempotentes: https://docs.bullmq.io/patterns/idempotent-jobs
- BullMQ — métricas OpenTelemetry: https://docs.bullmq.io/guide/telemetry/metrics
- MinIO — versionamento e object lock: https://docs.min.io/aistor/administration/object-locking-and-immutability/
