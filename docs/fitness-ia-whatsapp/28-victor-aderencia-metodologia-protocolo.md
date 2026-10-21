# Relatório — Victor (Engenharia de IA): aderência dos protocolos à metodologia do RT

**Data:** 2026-10-21
**Pasta do projeto:** docs/fitness-ia-whatsapp/
**Escrito para:** Rodrigo (fundador) e Léo (RT CREF). O resumo e as perguntas ao Léo são em linguagem de treino; o restante é técnico.

## 1. Resumo executivo

A IA **lê a metodologia** (a v3 publicada em produção, com o parágrafo de biomecânica e ordem por grupo, chega inteira ao modelo). O que falhava era a **execução**, por quatro motivos de engenharia — nenhum é "a IA não entendeu o texto":

1. **O modelo faz as contas da metodologia sem raciocinar.** O DeepSeek roda com `thinking` desligado (três testes com raciocínio ligado nunca fecharam o JSON). Volume por músculo na semana, ênfase, ordem dos grupos e tempo eram decididos token a token, e nada media o resultado.
2. **O único portão que conhece a metodologia estava quebrado.** O juiz de qualidade contextual devolveu `INVALID_REVIEW` em 3 de 4 execuções reais e em 27 de 28 no laboratório: uma única citação com a maiúscula trocada invalidava o parecer inteiro. Mesmo quando valia, ele via contagens por *padrão de movimento*, não por *músculo*, e aprovava "bíceps 3 / tríceps 3 séries" como "equilibrado".
3. **Dor virava veto total e esvaziava a base.** Todo empurrar/puxar leva ELBOW e SHOULDER no catálogo; terra e core levam LOWER_BACK; agachamento e afundo, KNEE. Dor leve em qualquer uma dessas regiões apagava padrões inteiros, o que é o contrário da metodologia ("dor restringe sem vetar"). Sem opções, o modelo completava a sessão com exercício de outro grupo (agachamento em dia de peito). Dos 7 protocolos com tag de lesão, 5 saíram incoerentes e 2 foram para o template de fallback.
4. **Uma regra do validador (isolado ≤ 70% por sessão) induzia a trapaça.** Dia de braços é isolado por natureza; para passar, o modelo punha supino fechado em dia de braços — e o Léo desfazia à mão. Nas 93 sessões que o Léo assinou, só 3 passam de 70% (todas montadas por ele) e a semana nunca passa de 64%.

Correções aplicadas, **sem hardcodar a metodologia**: o código continua sem conhecer números, ordem de grupos ou frequências. Ele passa a (a) obrigar o modelo a fazer e cumprir as contas num planejamento antes das sessões, (b) medir o rascunho com fatos neutros e entregá-los ao juiz e à correção, e (c) remover as pressões de código que contradiziam o texto do Léo.

## 2. Evidência (produção)

Fonte: 24 protocolos de 15–21/10, suas versões (`protocol_versions`) e traces de geração; diff entre a saída da IA (v1) e a versão assinada pelo Léo (v2, `PROFESSIONAL_EDIT`). Sem dados pessoais nos números abaixo.

| Padrão observado | Onde aparece | O que o Léo faz |
|---|---|---|
| Intercala grupos (agachamento → terra → leg press → mesa flexora; peito → costas → ombro → costas) | ordem de exercícios em quase todo protocolo | Reordena para "todo o grupo, depois o próximo" |
| Ênfase não vira volume (músculo-alvo com menos séries que os demais) | ~⅓ dos casos | Refaz a sessão |
| Dor apaga padrões: ombro/cotovelo → sem supino/remada/puxada/rosca/tríceps | 5 de 7 protocolos com tag | Reinsere supino/remada de máquina, leg press, com menos séries e RIR maior |
| Composto de outro grupo para passar em ISOLATION_AS_BASE | casos `bf1f2787`, `5dac7fcb`, `ed9cab5f` | Remove |
| Fallback por `ISOLATION_AS_BASE` ×3 em base esvaziada | 2 de 24 | Refaz do zero |
| Sessão de 90 min com ~50% do tempo ocupado | média 70% do tempo declarado | — |
| Bug de palavra-chave: "pe" (pé) casa com "peso"/"pessoa" e gera a tag ANKLE | qualquer texto livre de dor | — |

## 3. Mudanças

| # | Mudança | Arquivos principais |
|---|---|---|
| 1 | Campo `planejamento` no JSON, **antes** de `sessions` (divisão, séries semanais por grupo, ordem dos grupos e minutos por sessão). Descartado antes da persistência. Volta ao modelo na rodada de correção. | `protocol-generator.service.ts` |
| 2 | Base de referência apresentada **por grupo muscular** (ênfases do aluno primeiro); prioridade de favoritos/equipamento mantida dentro do grupo | idem |
| 3 | Medições neutras (`protocol-measurements.ts`): séries/semana/grupo, frequência, sequência de grupos por sessão, tempo estimado × declarado | novo |
| 4 | Juiz: citação tolerante (caixa/acento/pontuação) + 1 refazer; recebe as medições; novo critério `SESSION_SEQUENCING`; medições também na mensagem de correção | `contextual-quality.ts`, gerador |
| 5 | **Dor sem veto vira cautela** (`cautionTags`): fica na base marcada `cautela:`; prompt manda reduzir carga/volume e preferir máquina/cabo sem retirar o padrão. Continua veto: PAR-Q, orientação de evitar, acompanhamento ativo, piora, dor ≥ `PAIN_VETO_INTENSITY` (8) e tags clínicas. Painel mostra ao CREF os exercícios com cautela. Protocolo com cautela segue o fluxo normal (revisão opcional); só PAR-Q bloqueante exige revisão obrigatória (`CAUTION_PROTOCOL_REVIEW_URGENCY = 'OPTIONAL'`). | `user-constraints.ts`, `protocol-caution.ts`, renovação, worker |
| 6 | `ISOLATION_AS_BASE` passa a ser **semanal** (70%) | validador, `violation-feedback.ts` |
| 7 | Palavra-chave de lesão com fronteira de palavra | `user-constraints.ts` |
| 8 | `tome`/`dose` só bloqueiam ao lado de remédio/suplemento (mesmo critério já usado na conversa). "Segunda dose de costas" no `focus` ia ao fallback (3 de 10 gerações do perfil lombar) | `validation-rules.ts` |
| 9 | `ISOLATION` deixa de ser "padrão prioritário" de hipertrofia; bullets de ordem e de tempo reescritos apontando para a metodologia | `validation-rules.ts`, gerador |
| 10 | Literal de bootstrap da metodologia alinhado à v3 publicada; versões do pipeline (v6) e das regras (v7) | `methodology.ts` |
| 11 | Harness de avaliação offline | `apps/api/eval/` |

Não mudei: os números de volume, a frequência mínima por músculo, o tempo de sessão, nem o texto da metodologia.

## 4. Avaliação

Harness `apps/api/eval/`: pipeline real (gerar → validar → juiz → correções → reparo → fallback), DeepSeek V4 Pro, metodologia v3 e catálogo publicados, 15 perfis **sintéticos** que espelham os casos reais, 2 repetições. Medições são proxies descritivos — não substituem a leitura do Léo.

| Métrica | Baseline (28 execuções) | Final (30 execuções) |
|---|---|---|
| Queda em fallback | 1 | **0** |
| Passa na 1ª tentativa | 17/28 | **28/30** |
| Juiz sem parecer válido | 27/28 | 2/30 |
| Grupos que reaparecem na mesma sessão (por protocolo) | 1,18 | 0,87 |
| Sessões em que o músculo de ênfase abre | 52% | 70% |
| Volume da ênfase ÷ demais grupos | 1,26 | 1,81 |
| Exercício fora do que o título da sessão anuncia | 7,2% | 1,8% |
| Uso do tempo declarado (estimativa; informativo — o tempo é teto) | 70% | 79% |

Só perfis **sem** tag de lesão: retornos de grupo 1,44 → 0,56; ênfase abre sessão 58% → 71%; volume da ênfase ÷ demais 1,54 → 1,84.
Só perfis **com** dor: ênfase ÷ demais 0,75 → 1,84; exercício fora do título 14% → 1,4%; uso do tempo 56% → 74%; fallback 1 → 0. O caso de cotovelo (antes: fallback ou sessões incoerentes) passou a gerar um PPL coerente com sessões de peito, costas e pernas.

**Custo e latência:** de ~2,4 para ~2,9 chamadas e de ~5,8 mil para ~8,3 mil tokens de saída por protocolo (ordem de centavos de real); ~48 s → ~65 s por protocolo sob concorrência alta no laboratório. A geração é job de fila (lock de 120 s renovável).

## 5. Limites e riscos

- 2 repetições por perfil, perfis sintéticos: a variância do modelo é grande; os números indicam direção, não precisão. Falta a **leitura cega do Léo** em protocolos gerados antes × depois.
- As medições não decidem o que é certo. Duas delas ainda estão onde estavam: **séries/semana por músculo** (grupos ≥10 séries: 37% → 42%) e **frequência ≥ 2x** (67% → 64%). Em produção o Léo assinou, sem alterar, ABC de 3 dias e ABCDE de 5 dias com cada músculo 1x/semana, o que contradiz o texto escrito ("2x/semana sempre que os dias permitirem"). O juiz agora vê esses números; mas qual das duas versões vale é decisão dele (pergunta 1).
- Com cautela, o modelo nem sempre reduz séries/RIR dos exercícios marcados (no caso de cotovelo manteve 3 séries e RIR 2). Como a revisão é opcional (decisão abaixo), o painel lista ao CREF esses exercícios para conferência.
- O juiz ainda falhou em 2 de 30 execuções (citação não literal mesmo após o refazer): cai em "avaliação não concluída", como antes.
- Mudanças em `LANGUAGE_RULES` (item 8) são regra de compliance de linguagem: seguem a forma já adotada nas respostas conversacionais e precisam do aval do Alexandre.

## 6. Decisões do fundador e do RT (2026-10-21)

1. **Revisão com cautela:** revisão obrigatória só para PAR-Q bloqueante. Dor relatada, sem PAR-Q, gera o protocolo normalmente e vai à fila de revisão opcional. (`CAUTION_PROTOCOL_REVIEW_URGENCY = 'OPTIONAL'`.)
2. **Corte de dor forte:** 8/10 (`PAIN_VETO_INTENSITY = 8`).
3. **Tempo de sessão:** o tempo informado pelo aluno é o **teto**; o treino pode usar menos. Prompt e juiz foram ajustados (sessão mais curta que o tempo declarado não é lacuna; passar dele é).
4. **Frequência por músculo:** em aberto — ver a explicação na conversa; decisão do Léo sobre texto × prática.

## 7. Próximos passos

1. Léo lê 6–8 protocolos gerados pelo pipeline novo (perfis do harness) lado a lado com o antigo.
2. Decidir a frequência por músculo e, se for o caso, editar a metodologia no painel (nenhum deploy necessário).
3. Rodar `pnpm eval:protocol` a cada mudança de prompt/validador do gerador.
4. Se quiser reduzir ainda mais o intercalamento: checagem determinística pós-geração, só se o Léo confirmar que a regra é estável.

## Fontes consultadas

Banco e logs de produção (somente leitura), código do repositório, documentação interna (`docs/arquitetura/ARQUITETURA.md`). Sem pesquisa web nesta análise: os achados vêm de dados e experimentos próprios do projeto.
