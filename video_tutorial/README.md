# Vídeo de apresentação da MOVIVO

`movivo-apresentacao-final.mp4`: vertical 1080×1920, 2:56, com narração, legenda e trilha.

Nada aqui é gravação de celular. As telas web são o **app real** (build de produção) conduzido
pelo Playwright com uma API simulada. O WhatsApp é uma **réplica animada** (`gerador/studio/whatsapp.html`).
Por isso dá para mudar texto, dados ou ritmo e gerar tudo de novo.

```
video_tutorial/
├─ movivo-apresentacao-final.mp4   resultado
├─ MOVIVO GUIDE.mp3                trilha
├─ WhatsApp Audio …21.33.25.mpeg   narração (TTS, um arquivo com todos os blocos)
└─ gerador/
   ├─ montagem/   montagem: cortes, abertura/encerramento, legenda, mixagem
   ├─ studio/   gravação: cenas, réplica do WhatsApp, API simulada
   │  └─ takes/ as 5 gravações prontas (anamnese, wa1, wa2, checkin, wa3) + marks.json
   └─ words2.json   transcrição da narração com tempo por palavra
```

## Requisitos

- Dependências do monorepo instaladas (`pnpm install`). O gerador usa o Playwright de `apps/web`.
- Python 3 com `pip install imageio-ffmpeg` (ou a variável `FFMPEG` apontando para um ffmpeg completo).
- Google Chrome instalado, só para **regravar** cenas (o vídeo da landing é H.264).
- `pip install faster-whisper`, só para **trocar a narração**.

## 1. Gerar o vídeo final (a partir das gravações prontas)

```bash
python video_tutorial/gerador/montagem/gerar_final.py
```

Leva uns 3 minutos e sobrescreve `movivo-apresentacao-final.mp4`. Use isso depois de qualquer ajuste
de montagem, legenda, abertura/encerramento ou narração.

| Quero mudar…                                   | Arquivo                                   |
| ---------------------------------------------- | ----------------------------------------- |
| cortes e velocidade de cada trecho             | `montagem/make_studio.py` → `SHOTS`          |
| transições entre cenas                         | `montagem/make_studio.py` → `SECTION_XF`     |
| onde cada bloco da narração entra              | `montagem/mix.py` → `BLOCKS`                 |
| abertura e encerramento (logo, slogan, site)   | `montagem/scene.html`                        |
| estilo da legenda (fonte, cor de destaque)     | `montagem/captions.html`                     |
| correções de palavras na legenda               | `montagem/captions.py` → `FIX`               |
| volume da trilha / ducking                     | `montagem/mix.py` (`volume`, `sidechaincompress`) |

`gerar_final.py` imprime a linha do tempo (início de cada trecho no vídeo). Ela serve para reposicionar
os blocos de `BLOCKS` quando os cortes mudam.

## 2. Trocar a narração

1. Coloque o áudio novo em `video_tutorial/` e aponte `NARR` em `montagem/mix.py` para ele.
2. Transcreva: `python video_tutorial/gerador/montagem/transcrever.py "video_tutorial/<arquivo>"`.
   Isso atualiza `words2.json` e imprime cada palavra com seu tempo.
3. Em `BLOCKS` (`mix.py`), ajuste para cada bloco o início e o fim **no áudio** (cortes nas pausas entre
   frases) e o início **no vídeo**.
4. Rode `gerar_final.py`. A legenda acompanha sozinha.

## 3. Regravar uma cena

Dados, textos e roteiro de cada cena ficam nos próprios scripts:

| Cena                                          | Script                                    |
| --------------------------------------------- | ----------------------------------------- |
| landing + anamnese (nome, respostas, PAR-Q)   | `studio/scene-anamnese.cjs`               |
| check-in do treino (exercícios, cargas)       | `studio/scene-checkin.cjs`                |
| WhatsApp (mensagens, horários)                | `studio/scene-whatsapp.cjs` → `M`         |

Para regravar a anamnese ou o check-in, o app precisa estar no ar:

```bash
pnpm --filter @movivo/web build                       # build de produção
node video_tutorial/gerador/studio/studio-mock.mjs    # API simulada na porta 3201 (deixe rodando)
cd apps/web && MOVIVO_API_URL=http://127.0.0.1:3201/api/v1 npx next start --port 3000   # outro terminal
```

Depois, em `video_tutorial/gerador/studio/`:

```bash
node scene-anamnese.cjs            # ou scene-checkin.cjs
node scene-whatsapp.cjs wa1        # wa1 | wa2 | wa3 (não precisa do app no ar)
python take2mp4.py anamnese        # converte o take em takes/<cena>/<cena>.mp4 + marks.json
```

`node scene-<cena>.cjs --dry` percorre a cena sem gravar e salva prints de cada etapa. É útil para
conferir antes. Os cortes de `SHOTS` usam as marcações de `marks.json`, então uma regravação continua
encaixando sozinha. Em seguida, rode `gerar_final.py`.

O PDF do protocolo e o card do Story são gerados pelo código real da API. Para refazê-los, siga as
instruções no topo de `studio/render-pdf.ts.txt` e `studio/render-card.ts.txt`.
