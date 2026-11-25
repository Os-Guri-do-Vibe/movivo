# Alimentos padrão da aplicação

Estes dois arquivos são carregados no banco a cada deploy pelo `migrate.js`
([`reference-foods.ts`](../../src/core/database/reference-foods.ts)). A carga só **insere o que ainda
não existe**: nunca sobrescreve um alimento que a equipe editou ou reimportou pelo painel, e não
reativa um que foi desativado. Para trocar um valor de forma definitiva, edite o CSV aqui.

## `taco-4ed.csv` — TACO, 4ª edição ampliada e revisada (2011)

Tabela Brasileira de Composição de Alimentos, NEPA/UNICAMP: 597 alimentos, 100 g de parte comestível.
Dos 597, 593 têm valores publicados; os outros 4 (iogurte sabor abacaxi, leite de vaca integral,
leite de vaca desnatado UHT e coco verde cru) a própria TACO retirou da tabela ("`*`: as análises
estão sendo reavaliadas"). Eles entram pelo arquivo de complemento.

- **Origem:** `tabelas/alimentos.csv` do repositório `machine-learning-mocha/taco`, que converte a
  planilha oficial `Taco_4a_edicao_2011.xls`. Conferido contra a planilha oficial (energia, macros,
  fibra, minerais, vitamina C e colesterol) e contra o PDF da 4ª edição (umidade, energia, macros,
  colesterol e fibra dos 597 alimentos): nenhuma divergência.
- **Única alteração no arquivo:** o cabeçalho `Categoria do alimento` virou `Categoria`, nome que o
  importador reconhece. O corpo é idêntico ao original.
- **Símbolos** (legenda da TACO): `Tr` traço, vale 0; `NA` não aplicável, vale 0; vazio, análises não
  solicitadas; `*`, análises em reavaliação (nunca vira zero). Ver `taco-csv.ts`.

## `taco-complemento.csv` — alimentos que a TACO não publica

Cada linha traz a fonte na coluna `Fonte` e a explicação em `Referência`. Entram como
complemento (`CUSTOM`, código `<Fonte>-<número>`), separados da TACO, com selo na tabela do painel.
Aproximados: a TACO não os publica, então conferir com um nutricionista antes de depender deles.

Para incluir outro alimento aqui, preencha `Fonte` (2 a 16 letras ou números, sem espaço) e use o
número do alimento que ele ocupa na TACO, ou um próprio.

## Licença e citação

A TACO é de acesso público (NEPA/UNICAMP): NEPA-UNICAMP. *Tabela brasileira de composição de
alimentos (TACO)*. 4. ed. rev. e ampl. Campinas: NEPA-UNICAMP, 2011.
