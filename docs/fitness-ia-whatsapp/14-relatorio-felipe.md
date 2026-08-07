# Relatório — Felipe Yamamoto (Frontend Engineering)

**Data:** 2026-08-03  
**Ideia analisada:** MOVIVO — orientação de treino conversacional via WhatsApp, com IA como ferramenta e supervisão de profissional de Educação Física registrado no CREF  
**Pasta do projeto:** `docs/fitness-ia-whatsapp/`  
**Status do pipeline:** Fase 5 em andamento — frontend da Sprint 5 implementado, endurecido após revisão de Segurança e validado nos gates locais; integração final depende da conclusão conjunta do backend e da validação integrada de QA

## 1. Resumo Executivo

O frontend da Sprint 5 foi implementado para fechar a superfície de supervisão humana do MVP: autenticação exclusiva do profissional CREF, shell protegido, fila unificada, detalhes de caso, editor estruturado de protocolo, assinatura, liberação humana de PAR-Q, resolução de handoff/check-in e painel de operações com funil, SLA e replays anonimizados.

A solução usa o `AuthModule` JWT/RBAC existente por meio de um BFF same-origin no Next.js. Tokens nunca chegam ao JavaScript do navegador: ficam em cookies `httpOnly`, `SameSite=Strict`, com `Secure` em produção, rotação de refresh e revalidação `PROFESSIONAL` em `/auth/me` antes de cada proxy de dados de saúde. `ADMIN` é recusado antes de estabelecer a sessão CREF. Mutações também exigem `Origin` confiável e `Sec-Fetch-Site` compatível.

A entrega passou por lint, TypeScript, build de produção, 88 testes unitários/de componente, 10 testes E2E em Chromium e cobertura global superior ao gate de 80% em statements, branches, functions e lines. A auditoria SCA ficou limpa após atualizar centralmente PostCSS para `8.5.23`, correção oficial do `GHSA-fxqj-rqcc-2cmp`.

A notificação real-time foi fechada com SSE nativo, sem nova dependência. O navegador abre um `EventSource` same-origin no BFF, o BFF autentica o upstream com o JWT server-side e o evento opaco `queue.updated {"invalidate":true}` apenas invalida/recarrega a fila. Heartbeats não levam dados; o stream expira periodicamente no backend para revalidar a sessão. O polling de 30 segundos existe somente como contingência enquanto o `EventSource` está reconectando ou indisponível.

## 2. Objetivo da Interface

O objetivo foi tornar a supervisão CREF operacional, segura e inequívoca. A interface precisava permitir que o profissional:

- entrasse com a conta profissional existente, sem criar um segundo sistema de identidade;
- visse primeiro os casos de segurança e depois alertas e revisões de rotina;
- entendesse contexto, protocolo e conversa anonimizada antes de agir;
- editasse somente o contrato estruturado do protocolo, com motivo auditável;
- assinasse uma versão explicitamente revisada;
- liberasse uma sessão PAR-Q apenas por decisão humana consciente, sem valor previamente selecionado e sem estado de “liberação com ressalvas”;
- resolvesse handoffs e sinalizações de check-in pelo mesmo fluxo auditável, retirando o item da fila após sucesso;
- acompanhasse funil e SLA sem transformar dado ausente em uma métrica falsamente positiva;
- acessasse replays já anonimizados pelo backend.

A redação preserva os guardrails da MOVIVO: o profissional CREF aparece de forma permanente, a IA é apresentada como ferramenta e nenhuma decisão sensível é atribuída à IA isoladamente. Os termos proibidos foram verificados no código novo. A confirmação da anamnese deixou de prometer entrega “em até 2 horas”: agora comunica revisão profissional e envio posterior ao WhatsApp sem transformar a meta operacional em promessa ao usuário.

## 3. Arquitetura Frontend

### 3.1 Stack efetivamente utilizada

- Next.js `16.2.11`, App Router e React Server Components;
- React `19.2.8`;
- TypeScript `5.9.3` em modo estrito do projeto;
- Tailwind CSS `4.3.3` e os tokens existentes do design system O Pulso;
- componentes locais e o `Button` shadcn/Radix já instalado;
- Vitest + Testing Library para unidades e componentes;
- Playwright `1.61.1` para E2E em build de produção;
- PostHog já instalado, acionado somente quando a configuração pública está habilitada.

Nenhuma nova dependência de runtime foi adicionada.

### 3.2 Camadas

```text
Browser
  ├─ UI do dashboard e clientes same-origin
  └─ sem acesso a JWT/refresh token
          │
          ▼
Next.js BFF /api/dashboard/**
  ├─ valida input com Zod
  ├─ valida Origin / Sec-Fetch-Site
  ├─ mantém cookies httpOnly
  ├─ revalida PROFESSIONAL em /auth/me
  ├─ rotaciona refresh e repete uma chamada 401
  ├─ encaminha SSE com cancelamento e sem buffering/cache
  └─ adiciona Authorization no servidor
          │
          ▼
NestJS /api/v1
  ├─ JwtAuthGuard + RolesGuard
  ├─ PROFESSIONAL
  ├─ RLS/assignment no banco
  └─ ValidationService + auditoria autoritativos
```

O BFF reduz a exposição de credenciais, impede que o cliente monte `Authorization` e centraliza refresh, CSRF e tradução segura de erros. A checagem de sessão da camada de página fica em um DAL `server-only`, próxima ao dado, e não depende do Proxy para autorização.

### 3.3 Rotas entregues

- `/entrar` — login profissional, erros de permissão e sessão expirada;
- `/dashboard` — fila unificada de supervisão;
- `/dashboard/fila/[kind]/[id]` — contexto e ações por caso;
- `/dashboard/operacoes` — SLA, funil e replays anonimizados;
- `/api/dashboard/session/**` — login, leitura/rotação e logout;
- `/api/dashboard/queue/**` — fila e detalhe;
- `/api/dashboard/queue/events` — proxy SSE autenticado para invalidação real-time;
- `/api/dashboard/protocols/**` — edição e assinatura;
- `/api/dashboard/parq/**` — liberação humana;
- `/api/dashboard/handoffs/**` — resolução;
- `/api/dashboard/operations` — dados operacionais.

## 4. Estrutura de Componentes

### Shell e autenticação

- `LoginForm`: envio de credenciais ao BFF, estados pendente/erro e eventos analíticos;
- `DashboardLayout`: navegação responsiva, skip link, papel autorizado e respaldo CREF;
- `LogoutButton`: encerramento server-side da sessão e saída segura da superfície restrita.

### Supervisão

- `QueueBoard`: ordenação defensiva `SAFETY → ALERT → ROUTINE`, idade, estados, invalidação SSE e polling apenas de contingência;
- `QueueDetail`: composição por `PROTOCOL`, `PARQ`, `HANDOFF` e `CHECKIN`, com ação resolutiva para check-ins de segurança;
- `ProtocolEditor`: edição de fase, frequência, sessões, exercícios, repetições, descanso, carga, observações e motivo;
- `ConfirmAction`: confirmação modal nativa antes de ações irreversíveis ou sensíveis;
- `ConversationReplay`: renderização reutilizável de mensagens anonimizadas, separada do detalhe para reduzir o chunk de operações.

### Operações

- `OperationsDashboard`: cards de SLA com estado textual, funil com `<progress>` semântico e lista de replays;
- métricas `null` aparecem como `—`, “métrica ainda indisponível” ou “sem amostra suficiente”; nunca como `0` nem como “dentro da meta”.

Foram reutilizados `Button`, tokens, tipografia, cores e utilitários existentes. O componente de confirmação usa `<dialog>` nativo porque a plataforma cobre o requisito e evita nova dependência.

## 5. Estratégia de Estado e Dados

O estado é local e orientado a cada tela; não foi introduzido store global.

- Server Components protegem o shell e não serializam identificadores da sessão para o cliente.
- Client Components mantêm somente estado visual e drafts necessários.
- `AbortController` cancela carregamentos ao desmontar.
- Um único `EventSource` same-origin escuta `queue.updated` e recarrega a fila sem interpretar payload de domínio.
- Em erro do stream, o navegador mantém sua reconexão nativa e um único polling de contingência roda a cada 30 segundos somente com a aba visível; ao reconectar, o intervalo é encerrado.
- O stream é fechado no unmount e a volta da aba visível também sincroniza a fila, evitando perder invalidações recebidas em background.
- Atualizações manuais preservam o último dado válido e exibem falha acessível.
- Resoluções de `HANDOFF` e `CHECKIN` confirmadas navegam de volta para `/dashboard`, forçando a leitura da fila aberta já atualizada.
- O formulário PAR-Q começa com decisão vazia e só habilita a confirmação após seleção explícita de `RELEASED` e registro profissional válido.
- Parsers de runtime validam fila, detalhe, protocolo, replays e operações antes da renderização.
- A saída do editor passa primeiro por `protocolStructureSchema`; a API repete a validação e o `ValidationService` continua autoritativo.
- Nenhum endpoint ou payload aceita `user_id` vindo do navegador.

O contrato de integração foi alinhado entre frontend e backend durante a implementação. O contrato final preserva `item/context/protocol/replay/parq/handoff` no detalhe e `funnel/sla/replays` em operações.

## 6. Responsividade e Acessibilidade

A interface foi desenhada mobile-first e se expande para navegação lateral e grids maiores em desktop.

Medidas implementadas:

- HTML semântico com `main`, `nav`, `section`, `article`, `aside`, headings e listas;
- skip link para o conteúdo do dashboard;
- alvos interativos com pelo menos 44 px;
- foco visível com anel de alto contraste;
- campos associados por `label` e agrupamentos com `fieldset/legend`;
- estados de carregamento com `role=status`;
- erros com `role=alert` e sucesso com `aria-live`;
- severidade expressa por texto e ícone, nunca apenas cor;
- tabela do protocolo com cabeçalhos de coluna;
- `<progress>` com nome acessível contendo valor e percentual;
- modal nativo com foco, teclado e fechamento pela plataforma;
- animações existentes respeitam `prefers-reduced-motion` no CSS global;
- replays preservam quebras de linha sem interpretar HTML.

Os testes automatizados verificam papéis, nomes acessíveis, alertas, diálogos, labels e fluxo de teclado/browser. Como a própria documentação do Playwright alerta, automação não cobre toda a WCAG; auditoria manual com leitor de tela continua recomendada antes do go-live.

## 7. Performance e Otimizações

- Landing e demais rotas públicas continuam estáticas; a CSP com nonce foi limitada a `/entrar` e `/dashboard/**`, que já são dinâmicas.
- O dashboard usa Server Components para a guarda inicial e Client Components apenas onde existe interação.
- `ConversationReplay` foi extraído para impedir que a tela de operações importe todo o editor/detalhe.
- Não foi adicionado pacote de animação, cache ou gerenciamento de estado.
- SSE transmite somente invalidação; o payload completo continua no GET da fila, preservando contrato, cache e privacidade.
- O polling de contingência pausa em aba oculta e evita tráfego inútil; em conexão SSE saudável não existe polling periódico.
- O build preserva a landing como rota estática e as rotas de dashboard como dinâmicas.
- Todos os fetches sensíveis usam `cache: no-store`; respostas BFF também explicitam `Cache-Control: private, no-store, max-age=0` e `Pragma: no-cache` para navegador e intermediários.

O caso da Vercel reforçou a priorização do caminho crítico, redução de JavaScript e streaming. Os relatos da Linear reforçaram a importância de respostas locais rápidas e sincronização incremental. Esses materiais orientaram decisões, mas não constituem benchmark representativo da MOVIVO. Ainda não há RUM de produção para declarar LCP/INP reais.

## 8. Segurança Frontend

### Sessão e RBAC

- uso do `AuthModule` JWT/RBAC existente, sem duplicar identidade em Auth.js;
- cookies BFF `httpOnly`, `SameSite=Strict`, `Path=/`, `Priority=High` e `Secure` em produção;
- access token com vida de 15 minutos e refresh com vida máxima de 30 dias no BFF;
- rotação de refresh e uma única repetição da requisição após 401;
- limpeza de cookies após refresh inválido, 401/403 ou logout;
- validação exclusiva de `PROFESSIONAL` no login, no DAL, no BFF e novamente na API; credenciais `ADMIN` não criam sessão do dashboard CREF;
- revalidação de papel por `/auth/me` antes de cada chamada BFF a dados de saúde; resposta 403 é fail-closed, sem tentativa de refresh;
- respostas privadas e erros sensíveis usam `no-store`; o logout também devolve `Clear-Site-Data: "cache"`;
- caminhos de retorno limitados a `/dashboard`, evitando open redirect.

### SSE autenticado

- o navegador conecta somente ao endpoint same-origin `/api/dashboard/queue/events` e envia os cookies `httpOnly` automaticamente; nenhum JWT aparece em JavaScript, query string, body ou storage;
- o BFF revalida `PROFESSIONAL`, injeta `Authorization` apenas no fetch server-side e encaminha o stream de `/professional/dashboard/queue/events`;
- a resposta usa `private, no-store, no-cache, no-transform`, `X-Accel-Buffering: no` e `Connection: keep-alive`;
- `queue.updated` leva somente `{ "invalidate": true }`; não expõe usuário, UUID, categoria, horário, conteúdo, PII ou dado de saúde;
- o heartbeat não carrega dados e o backend encerra o stream em aproximadamente cinco minutos, fazendo a reconexão nativa revalidar sessão/RBAC;
- cancelamento do body downstream propaga ao stream upstream; o componente também chama `EventSource.close()` no unmount;
- `EventSource` gerencia reconexão/backoff nativos; o frontend não cria loop manual nem conexões paralelas.

### CSRF, XSS e exposição de dados

- mutações exigem `Origin` same-origin e rejeitam `Sec-Fetch-Site` cross-site;
- payloads e UUIDs são validados no BFF;
- mensagens externas são renderizadas como texto pelo React, sem `dangerouslySetInnerHTML`;
- replays chegam anonimizados e não recebem identificadores diretos no contrato do frontend;
- erros do BFF expõem somente mensagens e detalhes de validação permitidos;
- `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `nosniff`, COOP, Referrer Policy e Permissions Policy;
- CSP com nonce por request e `strict-dynamic` nas rotas autenticadas; `style-src-attr 'unsafe-inline'` é limitado a atributos de estilo exigidos pelo tema, sem liberar script inline;
- o Proxy configura CSP, mas não é usado como fronteira de autorização.

### Dependências

A revisão de advisories confirmou que React `19.2.8` e Next `16.2.11` estão acima das versões corrigidas para as vulnerabilidades RSC, nonce e Proxy consultadas. A auditoria encontrou PostCSS vulnerável por transitividade. O override central foi atualizado de `<=8.5.11 → >=8.5.12` para `<=8.5.22 → >=8.5.23`; a árvore agora resolve uma única versão `8.5.23` e `pnpm audit --prod` retorna “No known vulnerabilities found”.

## 9. Analytics e Instrumentação

Os seguintes eventos de produto foram instrumentados no cliente já existente do PostHog:

- `cref_login_succeeded`;
- `cref_login_failed`;
- `cref_queue_refreshed`;
- `cref_protocol_edited`;
- `cref_protocol_signed`;
- `cref_parq_released`;
- `cref_handoff_resolved`.
- `cref_checkin_resolved`.

A captura é condicional à configuração pública de analytics. Nenhum conteúdo de protocolo, resposta de saúde, texto de conversa, e-mail ou identificador do usuário é enviado como propriedade por esses eventos.

O painel de operações consome dados agregados produzidos pela API. Ausência de amostra é representada por `null`, não por zero. A integração futura com alertas Prometheus/Grafana e ingestão server-side de funil pertence a Henrique/Fase 6.

## 10. Integração com Backend

O frontend integra os endpoints autenticados em `/api/v1/professional/dashboard/**` por meio do BFF. O navegador nunca chama essa superfície diretamente.

Contratos principais:

- fila: `{ items, counts }`;
- eventos da fila: SSE `queue.updated` com `{ invalidate: true }` e heartbeat vazio;
- detalhe: `{ item, context, protocol?, replay?, parq?, handoff? }`;
- operações: `{ funnel, sla, replays }`;
- edição: `{ content, reason }`;
- assinatura: `{ confirmation: true }`;
- PAR-Q: `{ decision: "RELEASED", notes, confirmation: true }`; `RELEASED_WITH_RESTRICTIONS` foi removido do cliente e do BFF;
- handoff/check-in: `{ resolution, notes, confirmation: true }`, ambos enviados ao endpoint autoritativo de resolução de handoff pelo ID do alerta.

O frontend trata a validação local como conveniência de UX. Validação de segurança, RLS, assignment profissional, assinatura/hash, auditoria, PII Scrubber e efeitos de domínio continuam pertencendo à API.

O mock E2E implementa o contrato da API apenas para testes determinísticos do browser. Ele não substitui testes de integração do NestJS/PostgreSQL/Redis.

## 11. Estratégia de Testes

### Resultados finais do frontend

| Gate | Resultado |
|---|---:|
| ESLint web | aprovado, zero warnings |
| TypeScript | aprovado |
| Vitest | 18 arquivos, 88 testes aprovados |
| Statements | 90,59% |
| Branches | 82,46% |
| Functions | 89,62% |
| Lines | 94,29% |
| Playwright | 10/10 cenários aprovados |
| Build Next.js de produção | aprovado |
| `pnpm audit --prod` | nenhuma vulnerabilidade conhecida |

### Cenários cobertos

- contrato e parsers defensivos de fila, detalhe, contexto, replay e operações;
- payloads sem `user_id`;
- login com erro, papel negado e navegação segura, incluindo `ADMIN` sem cookies BFF;
- cookies de sessão `httpOnly` e `SameSite=Strict` no browser;
- ordenação de segurança;
- loading, erro, retry, vazio e sucesso;
- SSE autenticado com 401/403, headers anti-cache/anti-buffering, propagação de cancelamento, invalidação/reload da fila, teardown e polling somente em degradação;
- editor completo, motivo auditável, contrato local inválido e falha autoritativa do servidor;
- confirmação explícita de assinatura/liberação/resolução;
- PAR-Q sem decisão implícita, somente `RELEASED` e com registro profissional;
- handoff e CHECKIN SAFETY resolvidos pelo mesmo endpoint, com atualização da fila após sucesso;
- SLA excedido, SLA dentro da meta e SLA sem amostra;
- funil e replay anonimizado;
- CSP com nonce e bloqueio de framing;
- regressão da landing, anamnese e alternador de tema no mesmo servidor de produção.

O servidor E2E agora executa `next build --webpack` + `next start`; isso evita o HMR do modo dev mascarar corridas de navegação e testa a CSP realmente usada em produção.

## 12. Trade-offs

### SSE por invalidação em vez de payload completo ou Socket.io

SSE cobre a comunicação unidirecional exigida pela fila com a API nativa do navegador e sem dependência adicional. O evento não transporta o item: apenas invalida, e o GET autenticado recupera o estado autoritativo. Isso custa uma requisição adicional por evento, mas evita duplicar contratos e vazar metadados operacionais no stream global. `EventSource` assume reconexão/backoff; polling de 30 segundos existe somente como contingência durante erro/reconexão e é suspenso em aba oculta.

### CSP somente na superfície dinâmica

Nonce por request é incompatível com HTML estático pré-renderizado sem SRI: aplicar a política globalmente bloqueou corretamente os scripts estáticos durante o teste. A CSP estrita ficou em `/entrar` e `/dashboard/**`; a landing continua estática e conserva os demais headers de segurança. Upgrade: avaliar SRI experimental/estável do Next ou uma política de hashes para ampliar CSP sem sacrificar cache estático.

### BFF próprio em vez de Auth.js

O projeto já possuía identidade, Argon2id, access/refresh, rotação e RBAC no NestJS. Reutilizar isso pelo BFF evita dois emissores de sessão e uma dependência nova. O custo é manter explicitamente cookies, refresh e CSRF, cobertos por testes.

### Revalidação de papel por chamada BFF

O BFF consulta `/auth/me` antes de encaminhar cada operação com dados de saúde. Isso acrescenta uma chamada interna por request, mas evita confiar apenas no papel observado no login ou em estado cliente e fecha o acesso direto aos Route Handlers para `ADMIN`. O backend continua sendo a fronteira autoritativa e também restringe a superfície a `PROFESSIONAL`. Se a latência se tornar material, o upgrade aceitável é introspecção local de JWT assinada ou cache server-side curtíssimo com revogação; não será movida a confiança para o navegador.

### Modal nativo

`<dialog>` reduz dependências e oferece semântica/foco nativos nos navegadores modernos. Se a matriz futura incluir browsers sem suporte adequado ou exigir animações complexas, migrar para o Dialog Radix já compatível com o sistema shadcn.

### Métricas ainda indisponíveis

O frontend não inventa primeiro treino ou SLA sem amostra. Essa honestidade reduz apelo visual inicial, mas impede decisões operacionais baseadas em zero falso.

## 13. Checklist de Implementação

- [x] Login profissional sobre AuthModule existente.
- [x] Cookies `httpOnly`/Strict/Secure em produção e refresh rotativo.
- [x] RBAC exclusivamente PROFESSIONAL no frontend server-side, BFF e backend; ADMIN recusado antes da sessão.
- [x] Proteção CSRF por Origin e Fetch Metadata.
- [x] Shell responsivo e acessível.
- [x] Fila unificada e prioridade SAFETY.
- [x] SSE real-time same-origin/BFF, PROFESSIONAL-only e com payload opaco de invalidação.
- [x] Reconexão nativa, teardown/cancelamento e polling de contingência pausado em aba oculta.
- [x] Detalhe de protocolo, PAR-Q, handoff e check-in.
- [x] Editor estruturado com Zod compartilhado e motivo auditável.
- [x] Assinatura com confirmação explícita.
- [x] Liberação PAR-Q exclusivamente por ação humana consciente, somente `RELEASED` e sem decisão inicial.
- [x] Resolução de handoff e CHECKIN pelo mesmo endpoint, com retorno à fila atualizada.
- [x] Funil, SLA e replays anonimizados.
- [x] Ausência de amostra representada por `null`/indisponível.
- [x] Analytics sem PII/saúde.
- [x] CSP por nonce na superfície CREF.
- [x] Headers anti-framing, nosniff, COOP, Referrer e Permissions Policy.
- [x] `Cache-Control: private, no-store` em dados/erros privados e limpeza de cache no logout.
- [x] Gate de cobertura acima de 80%.
- [x] E2E em build de produção.
- [x] PostCSS `8.5.23` e auditoria limpa.
- [ ] Auditoria manual WCAG com leitor de tela.
- [x] Hardening solicitado por Sato incorporado: PROFESSIONAL-only, 403 fail-closed e respostas privadas sem cache.
- [ ] Validação formal de Alexandre/RT CREF do fluxo de assinatura e liberação.
- [ ] Validação integrada de Mariana sobre frontend + API + banco reais.

## 14. Próximos Passos

1. Leonardo concluir e congelar o contrato integrado e executar os testes de API/RLS/migração com PostgreSQL e Redis reais.
2. Mariana executar a US-5.7 completa: auth/RBAC, IDOR, RLS cross-tenant, cifra de check-in, PII em replay, auditoria de assinatura e fluxos frontend→API.
3. Sato confirmar no parecer consolidado que o hardening incorporado — PROFESSIONAL-only, 403 fail-closed e `no-store` — fecha os achados da revisão da superfície autenticada.
4. Alexandre e o RT CREF ratificarem por escrito assinatura per-usuário, liberação PAR-Q e copy operacional.
5. Henrique validar em produção timeouts de proxy/CDN, limite de conexões SSE, drenagem em deploy e métricas de conexões/reconexões; o fluxo funcional real-time já está implementado.
6. Configurar no ambiente de deploy `MOVIVO_API_URL`, chaves públicas permitidas e HTTPS; confirmar que cookies `Secure` estão presentes no ambiente real.
7. Rodar auditoria manual de teclado, VoiceOver/NVDA e zoom 200%/400%.
8. Coletar RUM de LCP, INP, CLS e erros do dashboard; nenhuma meta real deve ser declarada antes de tráfego representativo.

Bloqueios de lançamento, não de desenvolvimento: validações formais de Sato, Alexandre e RT CREF; credenciais/segredos reais; teste integrado com infraestrutura; e os bloqueadores globais já registrados no projeto (DPAs/ZDR, AraraHQ, pagamento e parecer INPI MOVIVO×VIVO).

## 15. Fontes Consultadas

### Next.js e React

- https://nextjs.org/docs/app/guides/content-security-policy
- https://nextjs.org/docs/app/guides/authentication
- https://nextjs.org/docs/app/guides/production-checklist
- https://nextjs.org/docs/app/getting-started/route-handlers
- https://nextjs.org/docs/app/api-reference/file-conventions/proxy
- https://react.dev/blog/2025/12/03/critical-security-vulnerability-in-react-server-components
- https://nextjs.org/blog/CVE-2025-66478

### Advisories de segurança

- https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
- https://pages.nist.gov/800-63-4/sp800-63b.html
- https://github.com/advisories/GHSA-fxqj-rqcc-2cmp
- https://github.com/vercel/next.js/security/advisories/GHSA-ffhc-5mcf-pf4q
- https://github.com/vercel/next.js/security/advisories/GHSA-26hh-7cqf-hhc6
- https://github.com/vercel/next.js/security/advisories/GHSA-267c-6grr-h53f
- https://github.com/vercel/next.js/security/advisories/GHSA-492v-c6pp-mqqv
- https://github.com/vercel/next.js/security/advisories/GHSA-ggv3-7p47-pfv8

### Acessibilidade, componentes e testes

- https://www.w3.org/TR/WCAG22/
- https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum
- https://playwright.dev/docs/accessibility-testing
- https://playwright.dev/docs/best-practices
- https://ui.shadcn.com/docs/components/radix/dialog
- https://ui.shadcn.com/docs/changelog
- https://motion.dev/docs/react-use-reduced-motion

### Server-Sent Events

- https://html.spec.whatwg.org/multipage/server-sent-events.html
- https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events
- https://developer.mozilla.org/en-US/docs/Web/API/EventSource/close

### Performance e casos de engenharia

- https://vercel.com/blog/how-we-made-the-vercel-dashboard-twice-as-fast
- https://vercel.com/blog/building-the-black-friday-cyber-monday-live-dashboard
- https://linear.app/changelog/2021-03-31-startup-performance-improvements
- https://linear.app/now/scaling-the-linear-sync-engine
- https://stripe.com/blog/engineering
- https://stripe.com/blog/connect-front-end-experience

**Limitação da pesquisa:** as fontes oficiais documentam padrões, correções e casos de referência, mas não fornecem benchmarks diretamente transferíveis ao tráfego e aos dados da MOVIVO. O projeto ainda não possui RUM de produção nem auditoria manual completa com tecnologia assistiva; essas medições permanecem obrigatórias antes do go-live.
