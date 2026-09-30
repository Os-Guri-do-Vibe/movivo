# Pendências de publicação — Termos de Uso e Política de Privacidade

**Data da revisão:** 29/09/2026

**Minutas:** `terms-2026-09-v1` e `privacy-2026-09-v1`
**Status:** `DRAFT_BLOCKED` — conteúdo para revisão, sem vigência e sem aceite novo.

## Resumo executivo e nível de risco

As duas minutas cobrem o Serviço e o checkout atuais, mas nenhum texto contratual torna a MOVIVO imune a reclamações ou fiscalização. O risco de publicar como contrato vigente **antes de identificar a prestadora e validar a operação CREF/LGPD é crítico**. O status das minutas deve continuar `DRAFT_BLOCKED` até todos os itens abaixo terem evidência e aprovação.

## Identificação e responsabilidade profissional

- [ ] Confirmar razão social, CNPJ ativo, endereço completo e canais de atendimento em operação; substituir os campos nas duas minutas.
- [ ] Confirmar registro CREF-PJ, nome, número/UF do CREF e atuação efetiva do Responsável Técnico; preencher os documentos e textos de consentimento versionados. Se a PJ e o registro ainda não existirem, **não apresentar o serviço pago como regularizado**.
- [ ] Nomear o Encarregado, publicar identificação e e-mail que receba e responda solicitações de titulares.
- [ ] Obter revisão final de advogado habilitado na OAB e aprovação técnico-profissional do RT. A revisão deve verificar normas do CREF regional e adequação real do Serviço às afirmações das minutas.

## Prova contratual, checkout e cancelamento

- [ ] Arquivar e disponibilizar o texto integral da versão aceita. O sistema aponta hoje para `terms-2026-08-v2`, mas este identificador não corresponde a Termos de Uso integrais existentes. **Não reescrever o passado:** criar `terms-2026-09-v1` após aprovação e registrar nova ciência com a versão exata; vincular a Política `privacy-2026-09-v1` à evidência de exibição.
- [ ] O checkout grava `sub-terms-2026-08-v1` e exige aceite de “Termos de Assinatura vigentes” sem documento integral identificado. Antes de receber cobrança real, exibir e versionar as condições comerciais integrais da seção 6–7 destes Termos ou criar documento próprio de assinatura; persistir qual texto foi exibido e aceito. O rótulo existente não é prova suficiente do conteúdo.
- [ ] Confirmar se o pagamento em produção usa Asaas, quais métodos estão homologados, como cada contrato renova, qual informação aparece antes de pagar e como o cliente recebe comprovante. Conferir preço total, parcelamento, Pix à vista versus Pix Automático, cancelamento e arrependimento em cada método. O catálogo vigente tem mensal, trimestral, semestral e anual; valores derivados de `packages/shared/src/schemas/subscription.schema.ts`.
- [ ] Validar o fluxo real do link individual `/conta/[token]` de cancelamento, reenvio de link e canal de atendimento; oferecer cancelamento eletrônico simples e comprovante. O caminho genérico `/conta` não existe.

## Dados, fornecedores e cookies

- [ ] Concluir inventário de prestadores **efetivamente ativos** em produção: hospedagem/região, Meta/WhatsApp e integrador, pagamentos, IA/LLM, transcrição de áudio, monitoramento e análise de uso; publicar anexo ou página de fornecedores vinculada à Política, com países e salvaguardas de transferências internacionais.
- [ ] Validar contratos com operadores, retenção/no-training, suboperadores e mecanismo internacional cabível antes de permitir dados de saúde em qualquer endpoint de IA. Manter o gate técnico fechado quando faltar comprovação.
- [ ] Definir prazos por categoria, rotina de eliminação/anonimização, ciclo de backup e prova de execução. O art. 27 do CDC justifica retenção **seletiva** de evidência para defesa por até 5 anos no cenário típico; não autoriza guardar tudo indiscriminadamente.
- [ ] Auditar PostHog em produção. `apps/web/instrumentation-client.ts` o inicia automaticamente se houver chave pública válida, sem preferência de cookies no próprio arquivo. Publicar inventário de cookies/SDKs e implantar escolha para recursos não essenciais, ou desabilitar a ferramenta até a base legal e a escolha estarem validadas. A minuta não deve prometer um controle ainda inexistente.
- [ ] Conferir textos e versões de consentimento de saúde, marketing e ciência de IA em `packages/shared/src/schemas/consent.schema.ts`, inclusive o placeholder `CREF nº ____`; qualquer texto novo exige nova versão imutável.

## Publicação

- [ ] Definir data de vigência, substituir todos os campos `[...]` e conferir que não restam informações fictícias ou indeterminadas.
- [ ] Alterar `publication_status` para `APPROVED` somente após evidência escrita das validações acima; então disponibilizar o conteúdo integral em rotas públicas ligadas à landing page, anamnese, checkout, área de conta e mensagens relevantes.
- [ ] Testar os links `/termos` e `/privacidade`, acessibilidade, leitura móvel, histórico de versões e que novos aceites registram as versões publicadas. Manter minutas inacessíveis como contrato enquanto `DRAFT_BLOCKED`.

## Fundamentação e fontes oficiais

- [LGPD — Lei nº 13.709/2018](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm), arts. 8º, 9º, 11, 16, 18, 20 e 33.
- [CDC — Lei nº 8.078/1990](https://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm), arts. 14, 27, 46, 49 e 51.
- [Decreto nº 7.962/2013](https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2013/decreto/d7962.htm), comércio eletrônico e arrependimento.
- [Marco Civil da Internet — Lei nº 12.965/2014](https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2014/lei/l12965.htm), arts. 7º, 10 e 15.
- [Lei nº 9.696/1998](https://www.planalto.gov.br/ccivil_03/leis/l9696.htm), exercício profissional de Educação Física.
- [ANPD — Resolução CD/ANPD nº 19/2024](https://www.gov.br/anpd/pt-br/acesso-a-informacao/institucional/atos-normativos/regulamentacoes_anpd/resolucao-cd-anpd-no-19-de-23-de-agosto-de-2024), transferência internacional.
- [ANPD — Guia de cookies e proteção de dados](https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes/guia-orientativo-cookies-e-protecao-de-dados-pessoais.pdf/@@display-file/file).
