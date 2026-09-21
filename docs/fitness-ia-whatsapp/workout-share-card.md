# Workout Share Card

Implementado no check-in diário em `/treino`. Depois de **Enviar e finalizar**, o diário
recarrega os dados confirmados pelo servidor e prepara automaticamente um PNG **1080 × 1920 com fundo transparente**, para sobrepor à foto do aluno.
Ao abrir um treino concluído no histórico, a imagem fica disponível novamente.

## Integração e fontes de dados

- `WorkoutJournalService.journal()` acrescenta `workout.shareCard` ao contrato existente;
  não há rota pública, upload, tabela nova ou migração.
- Sexo: `users.biologicalSex`, convertido de `MALE/FEMALE` para `male/female`. Registros
  antigos sem sexo continuam com o diário disponível, sem presumir um modelo anatômico.
- Duração: `workout_sessions.durationSeconds`, calculado pelo cronômetro existente.
- Exercícios: prescrição salva em `workout_sessions`, com pelo menos uma série válida
  (`setNumber > 0`) concluída e não pulada. Aquecimentos isolados e exercícios pulados
  não acrescentam músculos ao card.
- Músculos: última versão de cada exercício no catálogo até a conclusão daquele treino.
  O catálogo de bootstrap cobre registros legados sem versão no banco. Uma edição futura
  do catálogo não troca os grupos musculares de uma sessão já concluída.
- `mapWorkoutMuscles()` é a classificação única para texto e identificadores anatômicos;
  normaliza aliases e remove duplicatas. Usa os grupos catalogados, sem inferir músculos
  adicionais pelo nome do exercício ou com IA.

O campo de resposta é aditivo/opcional para compatibilidade com versões anteriores.
A autenticação, `Cache-Control: private, no-store` e as transações por titular do diário
continuam sendo usados. A imagem fica apenas em memória no navegador até o aluno escolher
uma ação; não contém nome, telefone, token, cargas, anamnese ou relatos de dor.

## Componentes e exemplo de uso

- `WorkoutShareCard.tsx`: composição fixa, logo local, frente/costas via
  `js-rich-body-highlighter`, Verde Pulso `#25E27E` e duração. A frase motivacional fica
  em uma única linha e as linhas verdes dos cantos são preservadas.
- `generateWorkoutShareCard.ts`: espera imagens, exporta com `html-to-image.toBlob()` e
  `pixelRatio: 1`, independentemente do DPR da tela.
- `useWorkoutShareCard.ts`: geração automática, retry, descarte de resultados antigos,
  limpeza de URLs e ações nativas com fallback.
- `WorkoutShareCardPanel.tsx`: prévia, estados de carregamento/erro e quatro ações.
  O diário carrega esse módulo sob demanda apenas para sessões concluídas.

```tsx
'use client';

import { WorkoutShareCardPanel } from '@/components/workout/share-card/WorkoutShareCardPanel';
import { workoutShareCardMock } from '@/components/workout/share-card/workout-share-card.mocks';

// Troque o mock por journal.workout.shareCard, como já faz WorkoutJournalView.
export function Example() {
  return <WorkoutShareCardPanel data={workoutShareCardMock} />;
}
```

`workout-share-card.mocks.ts` contém exemplos sintéticos masculino (3 grupos, 90 minutos)
e feminino (14 grupos, 65 minutos). O contrato `WorkoutShareCardData` e seu schema Zod são
exportados por `@movivo/shared`.

## Ajuste visual de 18/09/2026

A imagem não exibe mais “Ciência que treina com você”, título/lista de músculos ou o
rodapé CREF. Os músculos continuam destacados nos corpos anatômicos. A frase
“BETTER THAN YESTERDAY.” fica em uma linha, em branco e centralizada no grid direito,
assim como “Siga @movivo.br”, em Verde Pulso. O grid fica na parte inferior da imagem.
No topo, “MOVE YOUR POTENTIAL.” fica centralizada na imagem, com fonte de 25px, do mesmo
tamanho de “Siga @movivo.br”. O título “Seu movimento. Sua conquista.” foi removido.
O rótulo “Tempo de Treino”
e a duração ficam centralizados horizontalmente no grid direito. O fundo e o canvas não recebem
preenchimento: o PNG mantém transparência real. O xadrez escuro aparece somente na
prévia da página para facilitar a visualização, nunca no arquivo baixado.

## Exportação e compatibilidade

O layout de `/treino` usa `connection()` para renderizar a cada requisição, incluindo
`/treino/acessar`. A versão estática dessas rotas emitia scripts sem nonce e não hidratava
em produção sob a CSP do proxy. A política de segurança foi preservada.

- **Baixar imagem:** download do arquivo `movivo-treino-AAAA-MM-DD.png`.
- **Copiar imagem:** Clipboard API com `image/png`; indisponibilidade/permissão negada
  inicia download e informa o aluno.
- **Compartilhar imagem / Salvar na galeria:** Web Share API com o arquivo PNG, se
  `navigator.canShare({ files })` permitir; o destino é escolhido pelo aluno no menu do SO.
  Cancelar o menu não dispara download.
- Sem suporte nativo, o arquivo é baixado. A prévia também permite o gesto nativo de
  manter pressionado para salvar, quando o navegador disponibilizar essa ação.
- Navegadores não oferecem acesso universal de escrita à galeria nem garantem que
  Instagram/Stories apareça como destino. Nesse caso, o aluno abre o PNG baixado no Instagram.
- As ações só são habilitadas com o PNG pronto, preservando a ativação por toque exigida
  pelo Safari. Falha/timeout de imagem permite tentar de novo sem reenviar o check-in.
- A composição usa fonte de sistema para manter as métricas no PNG sob a CSP da MOVIVO.
  Fontes embutidas em SVG/`foreignObject` eram bloqueadas pela política e alteravam as
  quebras de linha. Não foi necessário relaxar a CSP. Corpos e logo são servidos localmente.
- A biblioteca oferece 14 grupos. Categorias sem máscara, como pescoço e sistema
  cardiovascular, permanecem nos dados de acessibilidade, com corpo neutro nessas regiões. Não pintamos
  outra região como aproximação. “Corpo inteiro” destaca os 14 grupos disponíveis.

## Verificação

```sh
pnpm --filter @movivo/shared build
pnpm --filter @movivo/shared test src/workout-share-card.spec.ts
pnpm --filter @movivo/api test src/modules/workout/workout-journal.service.spec.ts
pnpm --filter @movivo/web test src/components/workout
pnpm --filter @movivo/web exec playwright test workout-share-card.e2e.ts --workers=1
```

O E2E percorre a finalização, confere o layout mobile, a frase em uma linha e a remoção
dos textos solicitados. Baixa o PNG, lê seu cabeçalho binário para verificar 1080 × 1920
e verifica o canal alfa em áreas livres da imagem exportada.
Os PNGs masculino/feminino ficam como anexos em `apps/web/test-results/` para revisão visual.
Os testes de navegador usam API simulada; ações de compartilhamento são verificadas com
APIs nativas simuladas. A seleção real do Instagram e o salvamento na galeria dependem
do dispositivo e devem ser conferidos em um celular na homologação.

## Fontes Consultadas

- Biblioteca e identificadores: https://github.com/crmapache/js-rich-body-highlighter
- Exportação PNG e opções: https://github.com/bubkoo/html-to-image
- Web Share e ativação transitória: https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share
- Clipboard de imagem: https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/write
- Next.js: guia local `apps/web/node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md`.
