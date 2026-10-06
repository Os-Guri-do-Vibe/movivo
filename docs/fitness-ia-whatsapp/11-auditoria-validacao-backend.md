# Auditoria — Sato: validação sempre no backend

**Data:** 2026-10-06  
**Projeto:** MOVIVO — `docs/fitness-ia-whatsapp/`  
**Escopo:** entradas HTTP, upload e validação de regras de negócio no servidor.  
**Status:** correções implementadas e verificadas; publicação autorizada e acompanhada pelo PR desta branch.  
**Branch:** `fix/validacao-backend`, baseada em `cdc783858b06029bf014e1f28f7a621d55d64eb1`.

## Resumo executivo

As rotas auditadas já usam schemas e verificações no backend, além dos guards de autenticação, autorização e RLS das auditorias anteriores. Foram encontrados problemas na resposta a entradas inválidas, na validação de datas e arquivos, nos limites de coleções e na aplicação de regras de estado sob concorrência. As correções verificam os dados e o estado autoritativo antes da persistência; o frontend continua tendo apenas o papel de ajudar o usuário a preencher os campos.

## Contexto e método

A análise segue `docs/arquitetura/ARQUITETURA.md`, as decisões existentes de produto e as auditorias anteriores de autenticação, autorização e RLS. Foram rastreados controllers, schemas compartilhados, services, escrita no PostgreSQL, consumidores dos helpers alterados e testes de integração. As verificações HTTP enviam entradas diretamente à API, sem executar validação do frontend.

O `ValidationPipe` global do Nest valida DTOs com metadados de classe, mas não torna interfaces TypeScript ou parâmetros `unknown` validadores em runtime. Nessas rotas, a defesa efetiva é o schema Zod chamado pelo controller/service. O filtro global introduzido trata a falha desses schemas; ele não substitui a chamada ao schema.

## Critérios verificados

| Critério | Verificação no servidor |
| --- | --- |
| Tipo | Schemas de objetos, strings, números, booleanos e arrays; rejeição de tipos incompatíveis. |
| Tamanho | Limites de corpo HTTP, strings e coleções; upload limitado pelo tamanho efetivo do buffer. |
| Formato | E-mail, telefone, datas reais do calendário e assinatura binária de avatar. |
| Enum | Valores permitidos definidos nos schemas, incluindo séries, planos e respostas do check-in. |
| Faixa numérica | Limites de séries, repetições, carga, medidas e regras de idade nos respectivos fluxos. |
| UUID | Validação dos identificadores recebidos antes de consultar os recursos. |
| Permissões | Identidade derivada de sessão/token; ownership, capacidades administrativas e RLS no backend. |
| Estados permitidos | Verificação transacional do estado e da validade antes de gravações concorrentes. |
| Campos obrigatórios | Campos e blocos exigidos por schema, mais requisitos condicionais como verificação do telefone, consentimentos e declarações. |

Objetos Zod que removem campos extras continuam expondo apenas os campos declarados à persistência. Não foi adotada uma rejeição global de todos os campos extras: isso mudaria contratos sem necessidade. O cancelamento passou a usar um objeto estrito, por ter uma única entrada opcional conhecida.

## Achados e correções

### 1. Erros Zod sem tratamento HTTP uniforme

Algumas rotas chamavam `.parse()` diretamente. Uma entrada inválida podia resultar em HTTP 500 e percorrer o tratamento padrão de exceção, apesar de o schema já impedir a operação.

Foi registrado `ZodExceptionFilter` no módulo core: erros Zod agora retornam HTTP 400 com mensagem genérica. A resposta não serializa valores recebidos, nomes de campos ou informações de saúde. Falhas de estado da assinatura são convertidas em HTTP 409, preservando os demais erros.

### 2. Datas com formato correto, mas inexistentes

Expressões regulares e conversão por `Date` não eram suficientes para rejeitar todas as datas inexistentes. Os schemas de anamnese, despesas, anúncios e composição de parceiros passaram a usar `z.iso.date()`, incluindo validação do calendário e de anos bissextos.

### 3. Coleções sem limite coerente e motivo de cancelamento permissivo

O check-in aceitava uma quantidade ilimitada de respostas repetidas. Agora a coleção tem teto correspondente às opções disponíveis. As localizações do catálogo de exercícios têm limite e não aceitam duplicatas.

O motivo de cancelamento antes podia ser ignorado quando tinha tipo incompatível ou truncado quando excedia o limite. O backend agora rejeita tipo inválido, tamanho acima de 500 caracteres após aparar espaços e campos não declarados, antes de chamar o serviço.

Os parâmetros informativos de duração e descanso do catálogo foram preservados conforme a decisão de produto já registrada no código. Eles não são usados como limites de execução do protocolo; impor os mesmos limites criaria uma regra nova sem justificativa.

### 4. Estado válido na leitura, inválido na gravação concorrente

- **Treinos:** salvar séries e finalizar passam a verificar a sessão do aluno sob bloqueio de linha, dentro da transação. Apenas sessões em andamento podem receber essas operações. Uma sessão concluída não pode ser reiniciada ou finalizada novamente. Duas finalizações concorrentes não sobrescrevem o resultado nem duplicam o enfileiramento pelo mesmo caminho.
- **Check-in:** a submissão usa atualização condicional por token, estado pendente e validade pelo relógio do banco, com retorno obrigatório. Apenas quem efetivamente altera a linha pode enfileirar o processamento. Reenvio e expiração também condicionam a atualização ao estado atual.
- **Renovação:** a etapa e o progresso são gravados em uma única atualização condicionada a token, estado e validade. A submissão bloqueia e relê a sessão antes de verificar blocos, consentimento e regras de segurança. O scheduler não reativa uma sessão já submetida usando uma leitura antiga.
- **Anamnese:** salvar uma etapa agora bloqueia e relê a sessão; os blocos, a mescla de dados de saúde e o progresso são gravados na mesma transação. A validade é conferida novamente na atualização final, cuja falha desfaz toda a etapa. A submissão bloqueia e relê a sessão antes de criar o usuário; revalida os blocos, a posse do telefone, consentimentos, idade e PAR-Q sobre o estado atual. A atualização final exige estado e validade compatíveis; falha nessa atualização desfaz a criação do usuário pela mesma transação.

- **Assinaturas:** o repositório central bloqueia a linha e valida a transição sobre o estado atual antes de atualizar a assinatura e registrar o marco de ciclo de vida. Uma leitura antiga de um serviço não consegue reativar uma assinatura cancelada.

Os efeitos externos continuam passando pelas filas existentes. Esta alteração fecha as disputas de estado descritas; não redefine a arquitetura de entrega das filas.

### 5. Vigências administrativas fora de ordem

A autenticação do administrador não torna uma composição financeira semanticamente válida. O cadastro de preços de modelos e a substituição de composição de parceiros agora serializam as mudanças com bloqueio transacional e exigem início de vigência estritamente posterior ao último cadastrado. Datas iguais ou retroativas retornam HTTP 409 antes de fechar a vigência anterior, inserir registros ou auditar a alteração. Isso evita intervalos invertidos e múltiplas vigências abertas por esse caminho.

### 6. Avatar confiava no MIME informado

O storage validava a extensão a partir do MIME, mas não conferia os bytes recebidos. A validação agora ocorre no próprio `save()`, protegendo também chamadas internas:

- buffer obrigatório e não vazio;
- MIME em lista explícita;
- tamanho efetivo abaixo do limite configurado e do teto absoluto de 5 MiB;
- assinatura JPEG, PNG ou WebP compatível com o MIME; WebP também confere cabeçalho, chunk e tamanho RIFF;
- rejeição antes de criar diretório ou gravar o arquivo.

Essa verificação identifica o formato por assinatura. Não equivale a decodificação completa, sanitização da imagem ou análise antimalware. Os nomes continuam sendo gerados pelo servidor e a leitura continua usando o handler existente, com restrição de nome.

## Validação executada

Os testes de integração usam PostgreSQL, PgBouncer e Redis em um projeto Docker isolado, sem credenciais de provedores e sem modificar produção. Os testes unitários exercitam também leituras antigas, conflitos de estado, validade na gravação e ausência de escrita/enfileiramento quando a operação é recusada.

| Verificação | Resultado |
| --- | --- |
| `pnpm --filter @movivo/api test:cov` | 2.176 testes, 182 arquivos, todos aprovados. |
| `pnpm --filter @movivo/api test:int` | 318 testes, 42 arquivos, todos aprovados. |
| `pnpm --filter @movivo/shared test` | 169 testes, 13 arquivos, todos aprovados. |
| Build do backend e pacote compartilhado | Aprovados. |
| TypeScript do backend e frontend | Aprovado. |
| `pnpm lint` | Aprovado, sem warnings. |
| Formatação dos arquivos alterados e `git diff --check` | Aprovados. |

Cobertura final do backend: 90,48% de statements, 81,46% de branches, 88,16% de funções e 92,07% de linhas. Esses números descrevem a suíte do backend; não são uma porcentagem de segurança do sistema.

A regressão HTTP verifica campos obrigatórios, tipos, enums, faixas, tamanho de coleções, UUID e data inexistente. Duas finalizações simultâneas do mesmo treino resultam em uma aceitação e uma recusa; novas tentativas de editar/finalizar o treino concluído preservam os dados. O upload de HTML declarado como PNG é recusado e mantém o avatar anterior. O teste do repositório de assinaturas prova que uma escrita baseada em leitura antiga não reativa o estado terminal.

O ambiente de teste foi removido ao concluir a verificação. A publicação segue o pipeline de CI e deploy do repositório. A revisão e a saúde dos serviços em produção são verificadas após a conclusão do workflow de deploy.

## Decisões e entregáveis

Correções nos pontos compartilhados do backend e nos schemas já utilizados, sem dependências novas e sem substituir as regras de negócio existentes. Testes de regressão acompanham os comportamentos alterados. As políticas de RLS da auditoria anterior continuam em vigor; nenhum UUID enviado pelo cliente concede ownership.

A publicação futura deve executar os gates existentes de CI e deploy sobre o commit destas correções. Não há migração de banco introduzida nesta auditoria.

## Fontes Consultadas

- [OWASP — Input Validation Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html): validação sintática e semântica no servidor, limites e valores permitidos.
- [OWASP — Mass Assignment Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Mass_Assignment_Cheat_Sheet.html): campos permitidos e atribuição explícita.
- [OWASP — File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html): MIME declarado não é confiável; assinatura e limite de arquivo são camadas distintas.
- [NestJS — Validation](https://docs.nestjs.com/techniques/validation): validação em runtime e metadados dos DTOs.
- [NestJS — Exception filters](https://docs.nestjs.com/exception-filters): tratamento centralizado de exceções.
- [Zod — ISO dates](https://zod.dev/api?id=iso-dates): validação de datas ISO.
