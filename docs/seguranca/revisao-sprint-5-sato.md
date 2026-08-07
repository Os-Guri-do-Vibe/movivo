# Revisão de segurança — Sprint 5 (Gabriel Sato)

**Data:** 2026-08-03  
**Escopo:** Dashboard CREF, check-in semanal, reengajamento, consentimento, assinatura humana de protocolos, trilha de auditoria, autenticação/BFF e SSE.  
**Veredito para merge local:** **APROVADO COM RESSALVAS**.  
**Veredito para go-live:** **NÃO APROVADO** até o fechamento dos bloqueadores P0 deste relatório.  
**Risco residual atual:** **ALTO para produção**; **MÉDIO para merge local**, condicionado à execução verde das integrações PostgreSQL/Redis no CI.

## 1. Resumo Executivo

A Sprint 5 implementa defesa em profundidade adequada para desenvolvimento: o dashboard é exclusivo do profissional CREF autenticado e atribuído, a RLS é condicionada a vínculo e consentimento ativos, a revogação interrompe novos tratamentos, protocolos passam por validação e assinatura humana transacional, check-ins sensíveis são cifrados, e leituras/mutações clínicas geram auditoria imutável no nível da aplicação.

Durante a revisão foram encontrados e corrigidos riscos críticos: acesso clínico por `ADMIN`, identidade sintética do assinante, corrida de assinatura/edição, rotação concorrente de refresh token, continuidade de processamento após revogação, recursão/ordem de avaliação das policies RLS, dados livres na auditoria, respostas de check-in fora de ordem e vazamento de metadados no SSE.

O merge local pode prosseguir porque os testes unitários, cobertura, E2E e gates estáticos estão verdes. O go-live permanece bloqueado principalmente por: integração real não executada sem Docker, protocolos/PAR-Q derivados ainda em JSONB sem cifra, ausência de MFA para CREF, acesso global de `ADMIN` no banco, contrato AraraHQ ainda baseado em payload placeholder e detector de dor ainda não ratificado pelo Responsável Técnico.

## 2. Escopo Avaliado

- Backend NestJS: módulos `admin`, `checkin`, `auth`, `anamnesis`, `protocol`, `whatsapp`, workers e event bus.
- Frontend Next.js: login, BFF same-origin, fila clínica, edição/assinatura, PAR-Q, handoff, operações e SSE.
- PostgreSQL: migrations `0011`–`0016`, RLS `FORCE`, funções `SECURITY DEFINER`, vínculos profissionais, consentimentos e hash chain de auditoria.
- Redis/BullMQ: idempotência, roteamento de jobs e cancelamento lógico após revogação.
- Privacidade: minimização, consentimento, rastreabilidade, retenção e exposição de dados de saúde.
- Supply chain: versões instaladas de Next.js/React/PostCSS e auditoria de dependências.

Fora da validação local: infraestrutura real, DPA/ZDR dos provedores, credenciais de produção, CDN/WAF, integração contratual AraraHQ e pentest externo.

## 3. Modelo de Ameaças (Threat Model)

**Ativos prioritários:** anamnese/PAR-Q, protocolos individualizados, respostas de check-in, conversas, credenciais CREF, decisões humanas, consentimentos e trilha de auditoria.

**Atores:** atacante externo, usuário tentando IDOR/BOLA, conta CREF comprometida, conta administrativa excessivamente privilegiada, insider/DBA, provedor WhatsApp adulterado, job duplicado e operador com acesso a logs.

**Fronteiras de confiança:** navegador → BFF; BFF → API; webhook AraraHQ → API; API/workers → Redis/BullMQ; API → PgBouncer/PostgreSQL; profissional → dados dos titulares atribuídos; SSE → navegador autenticado.

**Cenários principais:** leitura cross-tenant, alteração/assinatura concorrente, liberação indevida de PAR-Q, replay de webhook, processamento após revogação, exfiltração por cache/log/SSE, roubo ou reuso de sessão, adulteração de auditoria e indisponibilidade por conexões/jobs.

## 4. Vulnerabilidades Identificadas

### Corrigidas nesta revisão

| ID | Achado | Risco anterior | Correção verificada |
|---|---|---:|---|
| S5-01 | Dashboard clínico aceitava superfície `ADMIN` | Crítico | Controller, service e BFF agora aceitam somente `PROFESSIONAL`; login administrativo não cria sessão clínica. |
| S5-02 | Assinante sintético/sem integridade referencial | Crítico | Assinatura exige CREF ativo e atribuição; FK em `protocols.professional_id`; migração remapeia ou invalida assinatura legada de forma fail-closed. |
| S5-03 | Corrida entre editar e assinar protocolo | Alto | `SELECT ... FOR UPDATE` serializa edição/assinatura; versão e hash são persistidos na mesma transação. |
| S5-04 | Revogação não interrompia todos os fluxos | Crítico | Revogação atômica carimba consentimento, desativa assignment, audita e bloqueia inbound, LLM, geração, outbound de saúde, check-in e dashboard. A confirmação de revogação permanece permitida. |
| S5-05 | Helper RLS podia lançar exceção por ordem indefinida de `AND/OR` | Crítico | Helper de predicado retorna `false` fora do contexto; mutadoras continuam lançando `42501`. |
| S5-06 | Policy de `consents` podia recursar pelo próprio helper | Crítico | `consents` não concede leitura ao `PROFESSIONAL`; não há chamada autorreferente. Funções privilegiadas têm `search_path` restrito, nomes qualificados e `EXECUTE` revogado de `PUBLIC`. |
| S5-07 | Refresh rotation vulnerável a corrida/reuso | Alto | Parse estrito e rotação/reuse detection dentro de transação com lock da sessão. |
| S5-08 | Auditoria mutável e com justificativas livres | Alto | Trigger bloqueia update/delete/truncate, hash chain serializada e `REVOKE`; justificativas ficam em hash, sem texto clínico livre. |
| S5-09 | Check-in aceitava quick reply fora de ordem | Alto | Estado esperado + compare-and-swap em `current_question`; somente a primeira progressão vence. |
| S5-10 | SSE podia expor metadados/cachear stream | Médio | Evento opaco `{invalidate:true}`, RBAC duplo, tokens apenas `httpOnly`, `no-store/no-transform`, sem buffering, teardown e reconexão/revalidação a cada ~5 min. |
| S5-11 | Telefone aparecia em logs do transporte | Alto | Destinatário redigido antes de registrar falhas. |

### Riscos residuais abertos

| ID | Risco residual | Classificação | Condição |
|---|---|---:|---|
| R-01 | `protocols.content`, `constraints`, `par_q_flags` e `protocol_versions.content` são dados de saúde derivados em JSONB sem cifra de coluna. | Alto | Bloqueia go-live. |
| R-02 | Painel CREF usa senha + sessão, sem MFA/passkey/AAL2. | Alto | Bloqueia go-live com dados reais. |
| R-03 | Policies base ainda concedem visão global a `ADMIN` sobre tabelas pessoais/de saúde. | Alto | Remover antes do go-live ou criar papel administrativo sem acesso clínico. |
| R-04 | Detector de dor é uma semente regex conservadora, sem vocabulário/limiar ratificado pelo RT. | Alto | Bloqueia go-live clínico. |
| R-05 | Contrato inbound AraraHQ continua marcado como payload placeholder. | Alto | Validar assinatura, replay e schema com conta real antes do go-live. |
| R-06 | Integrações PostgreSQL/PgBouncer/Redis e migrations não puderam rodar localmente. | Alto (confiança) | CI obrigatório antes de merge remoto/release. |
| R-07 | Reconsentimento tem suporte de banco por ciclos, mas não há jornada autenticada de autoatendimento para titular já cadastrado. | Médio | Criar fluxo explícito ou runbook DPO/suporte. |
| R-08 | Refresh concorrente entre réplicas BFF pode causar reuse detection e logout da família. | Médio | Single-flight distribuído ou desenho de grace window controlada. |
| R-09 | Hash de justificativa prova igualdade, mas não preserva o conteúdo recuperável da decisão clínica. | Médio | Guardar decisão estruturada/cifrada, se exigida pelo RT/jurídico. |
| R-10 | Reconciliação de grants/funções/RLS ocorre após migrations, fora de uma transação única. | Médio | Deploy com aplicação drenada e reconciliação transacional/fail-closed. |
| R-11 | SSE não possui cota explícita por profissional/IP; proxy/CDN ainda não foi validado. | Médio | Limites de conexão, timeout, HTTP/2 e teste de carga pré-go-live. |

## 5. Impacto Potencial

- **Confidencialidade:** exposição de condição física, PAR-Q, limitações e histórico de treino pode causar dano ao titular e incidente relevante sob LGPD.
- **Integridade/autenticidade:** assinatura ou liberação indevida pode entregar protocolo não revisado por profissional habilitado.
- **Disponibilidade:** abuso de SSE, refresh concorrente ou filas duplicadas pode indisponibilizar o painel e atrasar tratamento de alertas SAFETY.
- **Segurança física:** falso negativo no detector de dor pode não interromper exercício em contexto de risco.
- **Negócio/compliance:** sanções, notificação à ANPD/titulares, questionamento CREF, perda de confiança e suspensão do canal WhatsApp.

## 6. Probabilidade de Exploração

- Comprometimento de senha CREF sem MFA: **média**, impacto alto.
- Uso indevido de `ADMIN` ou falha futura de autorização: **média**, impacto alto.
- Exfiltração de JSONB sensível após comprometimento do banco/backup: **baixa a média**, impacto alto.
- Falha RLS por recursão/ordem de avaliação: **baixa após correção**, mas ainda depende da prova de integração.
- Replay/shape divergente do webhook real: **média** até homologação.
- Falso negativo de dor: **média** sem ratificação clínica.
- XSS/cache/token no dashboard: **baixa** após React encoding, CSP nonce, BFF `httpOnly` e `no-store`.

## 7. Classificação de Risco

**Sprint 5 para merge local: Médio — aprovado com ressalvas.** Não restou achado crítico conhecido no código revisado; as correções têm testes unitários/E2E.

**Produção com dados reais: Alto — não aprovado.** R-01 a R-06 devem ser fechados ou formalmente aceitos por Segurança, RT e Jurídico, com evidência técnica. Nenhum sistema será 100% seguro; após esses controles ainda haverá risco residual que deverá ser monitorado.

## 8. Controles de Segurança Recomendados

1. Cifrar dados derivados de saúde em `protocols` e `protocol_versions` com envelope encryption/KMS e rotação versionada.
2. Exigir MFA resistente a phishing (preferencialmente passkey/WebAuthn) para todo profissional CREF e operador privilegiado.
3. Separar `ADMIN_OPERACIONAL` de `PROFESSIONAL`; nenhuma role administrativa genérica deve obter dados clínicos por padrão.
4. Validar o webhook real AraraHQ com assinatura HMAC, timestamp/nonce, schema estrito, rate limit e allowlist quando disponível.
5. Ratificar com RT o léxico SAFETY e manter fallback conservador/handoff; criar corpus de regressão clínica.
6. Tornar reconciliação de privilégios/RLS atômica ou drenar a aplicação durante migrations.
7. Adicionar limite de SSE por identidade/IP e observabilidade de conexões; manter evento opaco.
8. Preservar decisões clínicas em estrutura cifrada e auditável, evitando texto livre em `audit_logs`.
9. Implementar single-flight de refresh no BFF e testar duas réplicas.

## 9. Impacto na Arquitetura

A Sprint adiciona um boundary clínico relevante: BFF server-side, controller/service profissional, assignments, audit log, check-in cifrado e stream SSE. O desenho mantém o monólito modular e reduz exposição do JWT ao navegador. RLS `FORCE` e consent-aware policies viraram a última barreira contra BOLA/IDOR.

As funções `SECURITY DEFINER` ampliam poder no banco e precisam permanecer estreitas, schema-qualified, sem `PUBLIC EXECUTE` e com testes reais de owner/BYPASSRLS. O SSE in-process é aceitável para uma réplica, mas exige Redis Pub/Sub e quotas quando houver escala horizontal. A cifra de protocolos exigirá migração online e adaptação do repositório/dashboard.

## 10. Impacto na Privacidade e LGPD

- Dados de saúde são sensíveis (LGPD arts. 5º e 11); minimização, finalidade e segurança devem ser requisitos do produto.
- A revogação atende ao art. 8º, §5º no caminho técnico: cessa novos tratamentos e preserva prova/retensão defensiva; deve haver canal de direitos claro e reconsentimento explícito.
- A desativação do assignment impede o profissional de continuar visualizando o titular após revogação.
- Auditoria de leitura (`HEALTH_DATA_VIEWED`) melhora prestação de contas, mas a política de retenção, acesso e expurgo precisa ser operacionalizada.
- IP/user-agent do consentimento e IDs em logs continuam dados pessoais pseudonimizados; acesso deve ser restrito e com retenção definida.
- Antes de produção: atualizar RIPD/ROPA, DPA com fornecedores, base legal por finalidade, encarregado/canal do titular e runbook de anonimização/retensão.

## 11. Estratégia de Monitoramento

Alertar, com correlação por identidade pseudonimizada, para:

- `auth_refresh_reuse`, falhas de login, 401/403 anômalos e mudanças de CREF/assignment.
- `HEALTH_CONSENT_REVOKED`, processamento descartado sem consentimento e tentativa profissional após revogação.
- `HEALTH_DATA_VIEWED`, assinatura, edição, liberação PAR-Q e resolução de SAFETY em volume/horário anormal.
- backlog/idade de SAFETY, DLQ, falhas de outbound e protocolo pendente acima do SLO.
- picos de SSE, conexões por ator/IP, reconexões e streams com mais de cinco minutos.
- falha da hash chain, mudança de grants/policies/functions e role com `BYPASSRLS`/ownership indevido.

Logs não devem conter telefone, e-mail, texto clínico, prompt, resposta de check-in ou token. Centralizar em SIEM com acesso mínimo, retenção imutável e relógio sincronizado.

## 12. Plano de Mitigação

**P0 — antes de merge remoto/release candidate**

- Executar no CI `db:migrate` do zero e upgrade, suites de integração PostgreSQL/PgBouncer/Redis e o int-spec de revogação/RLS/ADMIN/SYSTEM.
- Bloquear merge se migration `0015`/`0016`, hash chain, RLS ou isolamento falhar.

**P0 — antes de go-live**

- Fechar R-01 a R-05: cifra de protocolos, MFA, remoção do acesso clínico global de ADMIN, ratificação RT e homologação AraraHQ.
- Executar pentest autenticado e revisão LGPD/jurídica final.

**P1 — primeiros 30 dias**

- Fluxo de reconsentimento, decisão clínica cifrada, single-flight de refresh, quotas SSE e dashboards/alertas SOC.

**P2 — até 60 dias**

- Reconciliação transacional de privilégios, testes de restauração/DR, threat hunting, rotação de chaves e tabletop de incidente.

## 13. Estratégia de Resposta a Incidentes

1. **Detectar/classificar:** confirmar tipo de dado, titulares, janela, vetor, integridade de protocolos e risco físico.
2. **Conter:** revogar sessões/famílias JWT, desativar CREF/assignment, pausar worker/canal afetado, rotacionar secrets/chaves e bloquear IOC.
3. **Preservar:** snapshot forense, audit hash chain, logs de acesso, filas/DLQ, versões de protocolo e configuração de RLS; cadeia de custódia.
4. **Erradicar/recuperar:** corrigir causa raiz, restaurar de fonte confiável, reprocessar apenas jobs autorizados e validar isolamento/cifra antes de reabrir.
5. **Comunicar:** acionar Segurança, DPO/Jurídico, RT e liderança. Quando houver risco ou dano relevante, comunicar ANPD e titulares no prazo regulatório aplicável (atualmente três dias úteis), com conteúdo aprovado pelo Jurídico.
6. **Aprender:** post-mortem sem culpa, novos testes, atualização do RIPD/threat model e acompanhamento de ações.

## 14. Plano de Validação

### Executado no diff final

- API unitária: **86 arquivos / 587 testes — verde**.
- API cobertura: **91,92% statements; 83,82% branches; 89,40% functions; 93,27% lines**.
- Web unitária: **18 arquivos / 88 testes — verde**. Houve um timeout isolado sob execução concorrente; o arquivo e a suíte completa passaram no rerun sequencial.
- Web cobertura: **90,59% statements; 82,46% branches; 89,62% functions; 94,29% lines**.
- Playwright: **10/10 — verde**, incluindo cookie `httpOnly`, recusa de ADMIN, SSE, CHECKIN SAFETY, PAR-Q e CSP.
- `typecheck`, ESLint, Prettier, build, `pnpm audit --prod`, `git diff --check` e varredura de padrões de segredo: **verdes**.
- Dependências instaladas não estão nas faixas afetadas dos advisories consultados: Next.js `16.2.11`, React `19.2.8` e PostCSS `8.5.23`; auditoria retornou zero vulnerabilidades conhecidas.

### Não executado localmente

O Docker Desktop não possui daemon disponível (`docker info` não conecta ao engine). Portanto, não foi possível executar `test:int`, migrations reais, PgBouncer/RLS `FORCE`, Redis/BullMQ e upgrade de schema. Essa limitação impede aprovação de produção e deve ser coberta pelo CI antes do merge remoto.

### Pentest/auditoria recomendados

- BOLA/BFLA entre dois profissionais e titulares atribuídos/não atribuídos.
- Revogação durante leitura, SSE, jobs em voo, assinatura e check-in.
- Corridas de edit/sign, refresh, quick replies e reconsentimento.
- SQLi/XSS/CSRF, replay de webhook, SSRF/provider failure e abuso de SSE.
- Revisão de grants, owner/BYPASSRLS, `SECURITY DEFINER`, `search_path` e recursão de policies.
- Validação de backup cifrado, rotação de chave e restauração.

## 15. Próximos Passos

1. Mariana executa QA consolidado da US-5.7 e registra a evidência em `15-relatorio-mariana.md`.
2. Henrique/CI executa as integrações reais e torna o job bloqueante.
3. Leonardo implementa cifra de protocolos, separação de ADMIN e hardening de refresh/SSE.
4. Felipe mantém BFF/cookies/CSP e valida o comportamento atrás do proxy/CDN real.
5. RT ratifica o detector SAFETY e os critérios de liberação; Alexandre fecha LGPD/RIPD/fornecedores.
6. Sato realiza pentest final e somente então reavalia o veredito de go-live.

## 16. Fontes Consultadas

- OWASP API Security — BOLA: https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/
- OWASP API Security — BFLA: https://owasp.org/API-Security/editions/2023/en/0xa5-broken-function-level-authorization/
- OWASP Logging Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html
- OWASP Session Management Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
- OWASP CSRF Prevention Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html
- PostgreSQL — Row Security Policies: https://www.postgresql.org/docs/current/ddl-rowsecurity.html
- PostgreSQL — `CREATE FUNCTION` / `SECURITY DEFINER`: https://www.postgresql.org/docs/current/sql-createfunction.html
- PostgreSQL — regras de avaliação de expressões: https://www.postgresql.org/docs/18/sql-expressions.html
- NIST SP 800-63B-4 — Session Management: https://pages.nist.gov/800-63-4/sp800-63b/session/
- LGPD — Lei nº 13.709/2018: https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm
- ANPD — comunicação de incidente: https://www.gov.br/anpd/pt-br/canais_atendimento/agente-de-tratamento/comunicado-de-incidente-de-seguranca-cis?sck=direto
- ANPD — Regulamento de Comunicação de Incidente de Segurança: https://www.gov.br/anpd/pt-br/assuntos/noticias/anpd-aprova-o-regulamento-de-comunicacao-de-incidente-de-seguranca
- MDN — Server-sent events/EventSource: https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events
- Next.js advisory GHSA-ffhc-5mcf-pf4q: https://github.com/vercel/next.js/security/advisories/GHSA-ffhc-5mcf-pf4q
- Next.js advisory GHSA-26hh-7cqf-hhc6: https://github.com/vercel/next.js/security/advisories/GHSA-26hh-7cqf-hhc6
- React — critical RSC vulnerability: https://react.dev/blog/2025/12/03/critical-security-vulnerability-in-react-server-components
- PostCSS advisory GHSA-fxqj-rqcc-2cmp: https://github.com/advisories/GHSA-fxqj-rqcc-2cmp

**Limitação da pesquisa:** não foi possível consultar advisories privados dos fornecedores nem validar configurações das contas reais de AraraHQ, cloud, CDN, OpenAI/Anthropic ou pagamentos. A pesquisa pública e a auditoria do lockfile não substituem SCA contínuo, DPA e pentest de produção.
