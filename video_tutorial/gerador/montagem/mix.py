"""Mixagem final: narração (um arquivo só, recortado por bloco) sobre o vídeo, com ducking da trilha."""
import os, subprocess

import make_video as mv

NARR = os.path.join(mv.SRC, 'WhatsApp Audio 2026-10-14 at 21.33.25.mpeg')
VIDEO = os.path.join(mv.OUT, 'movivo-apresentacao-sem-audio.mp4')
MUSIC = os.path.join(mv.OUT, 'trilha-musical.m4a')
OUT = os.path.join(mv.OUT, 'movivo-apresentacao-narrada.mp4')

# (bloco, início na narração, fim na narração, início no vídeo) — recortes nas pausas
# entre frases, achadas por transcrição com timestamps por palavra.
BLOCKS = [
    ('1 abertura',       0.00,   8.55,   0.6),
    ('2a dados',         8.70,  15.10,  11.0),   # "código" = notificação chegando
    ('2b objetivos',    15.20,  22.85,  25.8),   # "objetivos" = tela Seus objetivos
    ('2c parq',         22.95,  35.45,  44.0),   # "nenhum treino é gerado" = o "Sim"
    ('2d pronto',       35.55,  39.30,  61.2),   # tela final
    ('3a coach',        39.40,  45.70,  67.0),
    ('3b pdf',          45.80,  56.00,  74.0),   # "protocolo em PDF" = PDF chegando
    ('3c audio',        56.10,  63.65,  94.8),   # "Ele responde" ≈ resposta chegando
    ('4a link',         63.75,  69.05, 109.6),
    ('4b series',       69.10,  81.60, 125.7),   # "pula um exercício" = toque em Pular
    ('4c fechamento',   81.65,  87.75, 139.9),
    ('4d story',        87.85,  91.45, 151.0),   # "card" = card na tela
    ('5 retorno',       91.50, 100.98, 157.0),
    ('6 encerramento', 101.05, 102.00, 170.6),   # "Movivo!" com o logo montado
]


def main():
    args = ['-i', VIDEO, '-i', MUSIC]
    filt = []
    for i, (name, a, b, at) in enumerate(BLOCKS):
        args += ['-i', NARR]
        n = i + 2
        filt.append(f"[{n}:a]atrim={a}:{b},asetpts=PTS-STARTPTS,afade=t=in:d=0.04,"
                    f"afade=t=out:st={b - a - 0.06:.3f}:d=0.06,aresample=48000,"
                    f"adelay={int(at * 1000)}:all=1[n{i}]")
    k = len(BLOCKS)
    filt.append(''.join(f'[n{i}]' for i in range(k)) + f'amix=inputs={k}:normalize=0:dropout_transition=0,'
                'highpass=f=80,acompressor=threshold=-20dB:ratio=3:attack=5:release=120,'
                'loudnorm=I=-15:TP=-1.5:LRA=7,aresample=48000,aformat=channel_layouts=stereo,'
                'apad=whole_dur={DUR},asplit=2[voice][key]')   # voz dura o vídeo todo: o ducking não encerra a trilha
    # trilha: base um pouco abaixo e afunda ~13 dB enquanto há voz
    filt.append('[1:a]volume=-3dB,aresample=48000,aformat=channel_layouts=stereo[mus]')
    filt.append('[mus][key]sidechaincompress=threshold=0.02:ratio=10:attack=40:release=450:makeup=1[duck]')
    filt.append('[duck][voice]amix=inputs=2:normalize=0:duration=first,alimiter=limit=0.95[a]')
    dur = float(subprocess.run([mv.FF, '-i', VIDEO], capture_output=True, text=True).stderr.split('Duration: ')[1].split(',')[0].split(':')[2]) + 60 * int(subprocess.run([mv.FF, '-i', VIDEO], capture_output=True, text=True).stderr.split('Duration: ')[1].split(':')[1])
    filt = [f.replace('{DUR}', f'{dur:.3f}') for f in filt]
    graph = os.path.join(mv.SCR, 'graph_mix.txt')
    open(graph, 'w', encoding='utf-8').write(';\n'.join(filt))
    subprocess.run([mv.FF, '-hide_banner', '-v', 'error', '-y', *args, '-filter_complex_script', graph,
                    '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k',
                    '-movflags', '+faststart', '-shortest', OUT], check=True)
    for name, a, b, at in BLOCKS:
        print(f'{name:15s} video {at:6.1f} - {at + b - a:6.1f}')


if __name__ == '__main__':
    main()
