# Validação jurídico-profissional — Sprint 5

**Data:** 3 de agosto de 2026  
**Agente responsável pela análise:** Alexandre — Head Jurídico  
**Ideia analisada:** MOVIVO — orientação de treino conversacional via WhatsApp, sob supervisão de profissional de Educação Física registrado no CREF  
**Pasta do projeto:** `docs/fitness-ia-whatsapp/`  
**Status:** **APROVADO COM RESSALVAS PARA HOMOLOGAÇÃO; NÃO AUTORIZA GO-LIVE**

## Resumo executivo

A Sprint 5 passou pela validação jurídico-profissional prevista no planejamento. Os achados bloqueantes identificados na primeira leitura foram devolvidos aos agentes de engenharia e corrigidos: o Dashboard de saúde foi limitado ao profissional CREF; a assinatura eletrônica passou a usar o profissional efetivamente designado e habilitado; a liberação do PAR-Q permaneceu exclusivamente humana; e a revogação do consentimento de saúde passou a interromper novos fluxos de saúde e a encerrar a designação profissional ativa.

O resultado é juridicamente mais defensável, mas a validação de código não substitui os atos externos necessários. Antes de produção, o Responsável Técnico CREF deve ratificar por escrito os gatilhos clínicos, as mensagens de segurança, a metodologia e o procedimento de supervisão. A pessoa jurídica, o Responsável Técnico, os contratos de tratamento de dados e o canal do Encarregado também precisam estar formalmente constituídos.

## Escopo recebido

Foram examinados os fluxos da Sprint 5 com impacto jurídico ou profissional:

- check-in semanal e relato de dor ou desconforto;
- Dashboard CREF e isolamento de dados por profissional designado;
- edição, assinatura e liberação de protocolos;
- liberação humana de PAR-Q de risco;
- auditoria das ações profissionais;
- consentimento específico para dados de saúde e sua revogação;
- mensagens ao usuário e limites da atuação da IA.

## Achados e correções incorporadas

### 1. Acesso a dados de saúde pelo papel `ADMIN`

**Risco identificado:** o contrato inicial do dashboard aceitava `PROFESSIONAL` e `ADMIN`, permitindo que um papel administrativo genérico acessasse dados de saúde, replays e decisões profissionais. Isso contrariava minimização, necessidade e a mensagem de que os dados seriam vistos pelo profissional responsável.

**Correção:** as rotas do Dashboard CREF e a sessão web foram limitadas ao papel `PROFESSIONAL`. O acesso operacional excepcional da organização permanece segregado na camada de banco e não equivale a uma autorização para uso cotidiano do painel de saúde.

### 2. Assinatura vinculada a identificador fixo

**Risco identificado:** uma assinatura produzida por UUID configurado não demonstrava que o profissional autenticado era o responsável ativo pelo titular, nem que possuía CREF ativo.

**Correção:** o identificador fixo foi removido. A assinatura agora depende de profissional com papel `PROFESSIONAL`, CREF ativo e designação ativa para o titular. O protocolo registra profissional, timestamp e hash do conteúdo. Dados legados com assinante inválido são remapeados apenas quando existe um responsável válido; caso contrário, a assinatura é removida e o protocolo volta ao estado de revisão pendente.

### 3. Liberação do PAR-Q

**Risco identificado:** estados intermediários ou decisões implícitas poderiam ser interpretados como liberação automática ou liberação com restrições não estruturadas.

**Correção:** o MVP aceita somente a decisão explícita `RELEASED`, executada por profissional autenticado, com CREF ativo, designação ativa e consentimento de saúde vigente. A opção textual `RELEASED_WITH_RESTRICTIONS` foi retirada até existir modelo estruturado e ratificado pelo Responsável Técnico. A IA e o motor não liberam PAR-Q de risco.

### 4. Revogação do consentimento de saúde

**Risco identificado:** registrar `revoked_at` sem bloquear workers, mensagens, geração de protocolo ou dashboard não implementaria uma revogação efetiva.

**Correção:** foi criado um gate transversal de consentimento para o recebimento de mensagens, check-in, geração de protocolo, processamento de IA e mensagens de saúde. A frase exata `REVOGAR CONSENTIMENTO DE SAÚDE` permite manifestação pelo WhatsApp. A revogação encerra a designação profissional ativa, bloqueando o dashboard para novos acessos regulares. Os registros anteriores necessários para prova, defesa e cumprimento de obrigações não são apagados automaticamente.

**Ressalva operacional:** eventual retorno do titular exige um novo fluxo de consentimento específico e destacado; o software não deve prometer reativação enquanto esse fluxo não estiver disponível.

### 5. Relatos de dor e supervisão humana

**Risco identificado:** um classificador amplo poderia tratar menções neutras a partes do corpo como dor ou, no sentido oposto, deixar de escalar desconforto relevante.

**Correção:** os gatilhos foram restringidos a linguagem contextual de dor/desconforto e cobertos por casos positivos e negativos. Relato compatível com o gatilho cria handoff `SAFETY`, orienta interrupção da atividade e procura de avaliação presencial; nunca altera carga ou protocolo automaticamente.

**Ressalva profissional:** a lista de expressões e a mensagem de segurança ainda precisam de ratificação formal do Responsável Técnico CREF. O classificador é um mecanismo conservador de roteamento, não uma avaliação clínica.

### 6. Trilha de auditoria

**Risco identificado:** leitura de replays e respostas de check-in, além das decisões de editar, assinar e liberar, precisava ser atribuível ao profissional.

**Correção:** as operações sensíveis geram eventos de auditoria com ator, titular, ação, timestamp e cadeia de hash. A tabela é append-only; atualização, exclusão e truncamento foram revogados. O texto livre sensível não é copiado integralmente para o log.

## Guardrails de comunicação verificados

- a IA é apresentada como ferramenta do profissional CREF, não como prescritor autônomo;
- não há promessa de resultado garantido;
- os textos novos não usam “diagnóstico”, “tratamento” ou “cura” como promessa ou atribuição do serviço;
- confirmações não prometem entrega ou revisão humana em prazo que o produto ainda não consegue assegurar;
- mensagens de segurança não prometem retorno humano e não oferecem orientação médica individualizada.

## Pendências obrigatórias antes do go-live

1. Ratificação escrita, pelo Responsável Técnico CREF, da metodologia, dos gatilhos de handoff, das mensagens de segurança e do procedimento de revisão/assinatura.
2. Cadastro efetivo da pessoa jurídica e do Responsável Técnico no CREF competente, com objeto social compatível com a atividade-fim.
3. Identificação real do profissional no ambiente produtivo, sem credenciais ou UUIDs de demonstração.
4. Publicação da Política de Privacidade e do canal do Encarregado; definição do fluxo completo de direitos do titular, inclusive novo consentimento após revogação.
5. Contratos/DPA e garantias de transferência internacional com provedores de IA, mensageria, observabilidade e infraestrutura; habilitação comprovada de Zero Data Retention quando aplicável.
6. Plano de resposta a incidentes com responsáveis e procedimento para comunicação à ANPD e aos titulares quando houver risco ou dano relevante.
7. Testes de integração em PostgreSQL/Redis reais, incluindo RLS, cifra, revogação, concorrência de assinatura/edição e migrações. Os testes unitários não substituem essa homologação.
8. Conclusão da análise de registro da marca MOVIVO no INPI e do risco de colisão com VIVO, já documentado no relatório de naming.

## Conclusão

O desenho consolidado satisfaz os controles técnicos mínimos esperados para a Sprint 5 e preserva a supervisão humana como autoridade sobre liberação e alteração do treino. A aprovação é **com ressalvas para homologação**: a Sprint não deve ser colocada em produção antes das pendências externas e da ratificação do Responsável Técnico.

Este documento registra uma revisão interna de produto e não substitui parecer jurídico formal, consulta ao CREF competente ou a responsabilidade técnica do profissional habilitado.

## Fontes consultadas

- [Lei nº 13.709/2018 — LGPD, texto compilado (Planalto)](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm)
- [Comunicação de Incidente de Segurança — Resolução CD/ANPD nº 15/2024](https://www.gov.br/anpd/pt-br/canais_atendimento/agente-de-tratamento/comunicado-de-incidente-de-seguranca-cis)
- [CONFEF — Responsabilidade Técnica de pessoa jurídica prestadora de serviços de atividade física](https://faq.confef.org.br/faq/index.php?action=faq&cat=15&id=19&artlang=pt-br)
- [CONFEF — Resolução sobre quadro técnico, supervisão e assinatura de planos de treino](https://www.confef.org.br/confefv2/includes/api/resolucoes/imprimir.php?id=561)
