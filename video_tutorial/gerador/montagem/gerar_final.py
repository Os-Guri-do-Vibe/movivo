"""Gera video_tutorial/movivo-apresentacao-final.mp4 a partir dos takes já gravados.

Uso (na raiz do repo):  python video_tutorial/gerador/montagem/gerar_final.py
Requer: Node com as dependências do monorepo (Playwright) e ffmpeg (FFMPEG=... ou `pip install imageio-ffmpeg`).
"""
import os, shutil, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
os.chdir(HERE)
run = lambda *c: subprocess.run(c, check=True)

run('node', 'render.cjs')            # abertura e encerramento (intro/, outro/, frame.png)
run('node', 'frame_cap.cjs')         # moldura com faixa de legenda
run(sys.executable, 'captions.py', '--json')
run('node', 'captions.cjs')          # quadros da legenda

sys.argv = ['make_studio.py', '--legenda']
import make_studio as ms, mix
ms.OUTDIR = os.path.join(ms.mv.OUT, 'legendado')
ms.main()
mix.VIDEO = os.path.join(ms.OUTDIR, 'movivo-apresentacao-sem-audio.mp4')
mix.MUSIC = os.path.join(ms.OUTDIR, 'trilha-musical.m4a')
mix.OUT = os.path.join(ms.mv.SRC, 'movivo-apresentacao-final.mp4')
mix.main()
for tmp in (ms.mv.OUT, 'intro', 'outro', 'caps'):   # intermediários (regenerados a cada execução)
    shutil.rmtree(tmp, ignore_errors=True)
for tmp in ('caps.txt', 'caption_states.json', 'graph_mix.txt', 'graph_studio.txt', 'frame.png', 'frame_cap.png'):
    if os.path.exists(tmp): os.remove(tmp)
print('pronto:', mix.OUT)
