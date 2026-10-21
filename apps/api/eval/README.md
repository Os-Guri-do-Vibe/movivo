# Harness de avaliação do pipeline de protocolo

Mede a **aderência do protocolo gerado à metodologia publicada** antes e depois de mudanças no
prompt, no validador ou no juiz contextual. Não roda no CI (chama o provedor real e custa
tokens): é ferramenta de engenharia de IA.

O que roda: o `planProtocol` de produção (gera → valida → juiz contextual → correções → reparo →
fallback) com DeepSeek V4 Pro (`thinking` desligado, temperatura 0.4), a **metodologia publicada**
e o **catálogo publicado** de produção, sobre perfis **sintéticos** (`profiles.ts`, espelham o
desenho dos casos reais — nenhum dado de aluno). O que mede (`metrics.ts`) são fatos neutros:
sequência de grupos por sessão, séries por grupo na semana, frequência, tempo estimado, ênfase
frente aos demais. As medições descrevem; **a regra é a metodologia** — por isso a comparação é
entre variantes, não contra metas fixas.

## Fixtures (fora do git)

Pasta com três arquivos, exportados de produção em modo somente leitura:

```bash
# metodologia PUBLICADA (versão mais recente com último evento PUBLISHED)
psql ... -A -t -c "SELECT content FROM methodology_versions v JOIN LATERAL (
  SELECT status FROM methodology_events e WHERE e.methodology_version_id = v.id
  ORDER BY sequence DESC LIMIT 1) l ON l.status = 'PUBLISHED' ORDER BY version DESC LIMIT 1" > methodology.md

# catálogo publicado (versão mais recente de cada exercício)
psql ... -A -t -c "SELECT json_agg(row_to_json(c)) FROM (SELECT DISTINCT ON (exercise_key)
  exercise_key id, name, pattern, muscle_groups, equipment, locations, levels,
  contraindicated_for, substitutes, measurement, status FROM exercise_catalog_entries
  ORDER BY exercise_key, version DESC) c WHERE status = 'PUBLISHED'" > catalog.json

# favoritos do RT
psql ... -A -t -c "SELECT json_agg(exercise_key) FROM exercise_catalog_favorites" > favorites.json
```

## Rodar

```bash
cd apps/api
EVAL_FIXTURES_DIR=/caminho/fixtures EVAL_VARIANT=minha-variante EVAL_REPEATS=2 \
  pnpm eval:protocol            # grava <fixtures>/out/minha-variante.json
```

Variáveis: `EVAL_PROFILES=id1,id2` (subconjunto), `EVAL_CONCURRENCY` (padrão 4),
`EVAL_MODEL` (padrão `deepseek-v4-pro`), `EVAL_CAUTION=0` (reproduz o veto total de dor anterior
à política de cautela), `EVAL_DEEPSEEK_KEY_FILE` (padrão: segredo de desenvolvimento).

Lembrete: cada execução completa faz 2-6 chamadas ao provedor; 15 perfis × 2 repetições custam
poucos dólares. Rode ≥ 2 repetições — a variância do modelo é grande.
