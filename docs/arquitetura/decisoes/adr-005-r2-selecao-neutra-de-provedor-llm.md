# ADR-005-R2 — Seleção neutra e condicionada de provedor LLM

**Status:** Aceita

**Data:** 2026-08-27

**Substitui:** ADR-005-R

## Contexto

A ADR-005-R removeu o DeepSeek de todos os fluxos apoiando-se em jurisdição, ausência de
salvaguardas públicas e um incidente de segurança. O incidente é evidência de risco, mas não é
um critério suficiente nem simétrico: qualquer provedor de nuvem permanece suscetível a falhas.
Também não é correto presumir que OpenAI ou Anthropic estejam aprovados apenas por marca; os
controles de retenção zero dependem da conta, do contrato e do endpoint efetivamente usados.

A Resolução CD/ANPD nº 19/2024 não proíbe transferência por país. Ela exige mecanismo válido e
garantias verificáveis para o caso concreto.

## Decisão

1. **DeepSeek V4 Pro é o candidato principal de qualidade/custo**, seguido por GPT-4.1 e Claude
   Sonnet 4.5 como fallbacks independentes.
2. Nenhum provedor recebe `HEALTH` por padrão. O `LLMRouter` exige atestado operacional explícito
   por provedor antes do envio.
3. O atestado só pode ser ativado depois de verificar, para a conta e endpoint contratados:
   - DPA e papéis controlador/operador;
   - mecanismo válido de transferência internacional, incluindo as cláusulas da ANPD quando
     aplicáveis;
   - retenção definida e no-training;
   - localização, suboperadores, exclusão e atendimento a titulares;
   - controles de segurança e comunicação de incidentes.
4. Histórico de incidente entra na avaliação de risco e diligência, nunca como banimento
   automático.
5. Qualidade é aprovada por benchmark MOVIVO de recuperação, suporte de afirmações, contradição,
   abstinência, segurança, latência e custo. Benchmark do fornecedor não substitui esse gate.

## Aplicação no runtime

As variáveis abaixo são `false` por padrão:

```text
LLM_DEEPSEEK_HEALTH_DATA_APPROVED
LLM_OPENAI_HEALTH_DATA_APPROVED
LLM_ANTHROPIC_HEALTH_DATA_APPROVED
KNOWLEDGE_OPENAI_EMBEDDING_HEALTH_DATA_APPROVED
```

O router verifica a classe antes do `fetch`. Um provedor não aprovado é ignorado sem receber
prompt, mensagem, embedding ou metadado do titular. `NON_HEALTH` continua permitido quando a
finalidade e a minimização de dados forem comprovadas pelo chamador.

## Preço e desempenho para a tarefa MOVIVO

Snapshot oficial de 2026-08-27, em USD por milhão de tokens:

| Modelo | Input sem cache | Input com cache | Output |
|---|---:|---:|---:|
| DeepSeek V4 Pro | $0,435 | $0,003625 | $0,87 |
| GPT-4.1 | $2,00 | $0,50 | $8,00 |
| Claude Sonnet 4.5 | $3,00 | $0,30 | $15,00 |

Em uma resposta fundamentada representativa com três gates (aproximadamente 7 mil tokens de
entrada não cacheada e 550 de saída), isso corresponde a cerca de **US$0,0035 no DeepSeek**,
**US$0,0184 no GPT-4.1** e **US$0,0293 no Claude**. É uma estimativa de comparação, não previsão
de fatura; cache, raciocínio, tamanho dos trechos e reajustes alteram o valor. A DeepSeek anunciou
política futura de horário de pico com multiplicador 2x, ainda sem data efetiva na fonte consultada.

Preço não demonstra qualidade. Benchmarks genéricos não medem recuperação dos documentos MOVIVO,
abstinência e aderência às restrições do aluno. Por isso, V4 Pro é **candidato**, não vencedor já
homologado: a promoção depende do golden set MOVIVO e de métricas de suporte por afirmação,
contradição, número inventado, recall da fonte, abstinência segura, latência e custo.

## Consequências

- Remove-se o viés categórico contra um fornecedor específico.
- A obrigação que antes existia apenas em documentação passa a ser bloqueio executável.
- Configuração incorreta fecha em indisponibilidade segura, não em vazamento silencioso.
- DeepSeek só atenderá dados reais de saúde quando a diligência contratual for concluída; até lá,
  pode ser avaliado com corpus sintético ou desidentificado.

## Fontes

- ANPD, transferência internacional: https://www.gov.br/anpd/pt-br/assuntos/assuntos-internacionais/transferencia-internacional-de-dados
- DeepSeek Privacy Policy: https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html
- DeepSeek Open Platform Terms: https://cdn.deepseek.com/policies/en-US/deepseek-open-platform-terms-of-service.html
- DeepSeek Models & Pricing: https://api-docs.deepseek.com/quick_start/pricing/
- OpenAI, controles de dados: https://developers.openai.com/api/docs/guides/your-data
- OpenAI, pricing: https://openai.com/api/pricing/
- Anthropic, retenção comercial: https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data
- Anthropic, pricing: https://docs.anthropic.com/en/docs/about-claude/pricing
