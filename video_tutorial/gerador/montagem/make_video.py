"""Monta o vídeo de apresentação da MOVIVO (vertical 1080x1920) a partir das gravações brutas."""
import subprocess, sys, os

SCR = os.path.dirname(os.path.abspath(__file__))
FF = os.environ.get('FFMPEG') or __import__('imageio_ffmpeg').get_ffmpeg_exe()   # pip install imageio-ffmpeg
SRC = os.path.abspath(os.path.join(SCR, '..', '..'))   # video_tutorial/
OUT = os.path.join(SCR, '..', 'saida')
FPS = 30
SW, SH = 830, 1798           # tela dentro da moldura
SX, SY = 125, 61             # posição da tela no quadro 1080x1920
BLUR = 'boxblur=16:2'        # desfoque leve, mas ilegível

LAND = '1_landing_page.mov'
ANAM = '2_formulario_anamnese.mov'
WHAT = '3_whatsapp primeira_interacao.mov'
CHEK = '4_checkin_diario.mov'
FEED = '5_captura final.png'

# Desfoques: (x, y, w, h, enable) na resolução da fonte; t = tempo desde o início do trecho
PHONE_FIELD = (550, 226, 370, 138, '1')
PHONE_TEXT = (100, 540, 480, 72, 'lt(t,4.5)')       # some quando o WhatsApp é confirmado (38,5s da fonte)

# Cada plano: (seção, arquivo, [(início, fim, velocidade), ...], desfoques).
# Vários trechos no mesmo plano são emendados sem transição: só são usados onde a tela
# é idêntica nos dois pontos (tempo morto na gravação), então o corte não aparece.
SHOTS = [
    ('landing', LAND, [(0.2, 10.6, 1.3)], []),
    ('anam', ANAM, [(0.0, 10.0, 1.7)], []),                                   # dados pessoais
    ('anam', ANAM, [(34.0, 40.5, 1.3)], [PHONE_FIELD, PHONE_TEXT]),           # confirma o WhatsApp
    ('anam', ANAM, [(50.0, 60.0, 1.7)], []),                                  # objetivos + mapa do corpo
    ('anam', ANAM, [(88.0, 98.0, 2.0)], []),                                  # rotina
    ('anam', ANAM, [(103.5, 111.5, 1.4)], []),                                # dores e limitações
    ('anam', ANAM, [(141.5, 148.7, 1.4)], []),                                # só falta confirmar
    ('whats', WHAT, [(21.5, 29.0, 1.2),      # boas-vindas do Coach
                     (40.5, 48.0, 1.4),      # chega o PDF
                     (48.0, 58.0, 4.0),      # rola a mensagem
                     (80.5, 84.0, 1.0),      # volta ao PDF e abre (animação nativa)
                     (84.0, 93.0, 2.0),      # percorre o protocolo
                     (93.0, 105.0, 2.2),     # grava e envia o áudio
                     (134.0, 140.5, 1.0)],   # resposta do Coach
     []),
    ('check', CHEK, [(0.3, 4.3, 1.3)], []),
    ('check', CHEK, [(5.0, 12.0, 2.5)], []),
    ('check', CHEK, [(12.0, 20.0, 2.0)], []),
    ('check', CHEK, [(20.0, 58.0, 5.0)], []),
    ('check', CHEK, [(58.0, 66.0, 3.0)], []),
    ('check', CHEK, [(66.0, 104.0, 6.0)], []),
    ('check', CHEK, [(104.0, 112.0, 3.0)], []),
    ('check', CHEK, [(112.0, 132.0, 2.5)], []),
    ('check', CHEK, [(132.0, 135.0, 1.0)], [], 3.0),   # segura o card "sua conquista merece um Story"
]
FEED_DUR = 8.0
XF_IN = 0.4                       # dissolve dentro da mesma seção
# transição entre seções: (tipo, duração). 'push' = troca de app, empurrão lateral com easing
SECTION_XF = {
    ('landing', 'anam'): ('fade', 0.5),
    ('anam', 'whats'): ('push', 0.8),
    ('whats', 'check'): ('fade', 0.6),
    ('check', 'feedback'): ('push', 0.8),
}
INTRO_DUR, OUTRO_DUR, XF_BOOKEND = 4.0, 7.0, 0.6

# P vai de 1 a 0 durante a transição; easeInOutCubic sobre o progresso
_E = "if(lt(1-P,0.5),4*pow(1-P,3),1-pow(2*P,3)/2)"
PUSH = ("st(0,W*" + _E + ");"
        "if(eq(PLANE,0),if(lt(X+ld(0),W),a0(X+ld(0),Y),b0(X+ld(0)-W,Y)),"
        "if(eq(PLANE,1),if(lt(X+ld(0),W),a1(X+ld(0),Y),b1(X+ld(0)-W,Y)),"
        "if(lt(X+ld(0),W),a2(X+ld(0),Y),b2(X+ld(0)-W,Y))))")


def blur_chain(label, blurs, out):
    """Aplica desfoque em retângulos, na resolução original da fonte."""
    if not blurs:
        return [f'[{label}]null[{out}]']
    parts, cur = [], label
    for i, (x, y, w, h, en) in enumerate(blurs):
        a, b, c, nxt = f'{label}a{i}', f'{label}b{i}', f'{label}c{i}', (out if i == len(blurs) - 1 else f'{label}n{i}')
        parts.append(f'[{cur}]split[{a}][{b}]')
        parts.append(f'[{b}]crop={w}:{h}:{x}:{y},{BLUR}[{c}]')
        parts.append(f"[{a}][{c}]overlay={x}:{y}:enable='{en}'[{nxt}]")
        cur = nxt
    return parts


def build_body():
    args, filt, durs, secs = [], [], [], []
    norm = f'fps={FPS},scale={SW}:{SH}:flags=lanczos:out_color_matrix=bt709:out_range=tv,setsar=1,format=yuv444p,settb=1/{FPS}'
    n = 0
    for i, (sec, f, segs, blurs, *opt) in enumerate(SHOTS):
        hold = opt[0] if opt else 0
        parts = []
        for j, (a, b, sp) in enumerate(segs):
            args += ['-ss', f'{a}', '-t', f'{b - a}', '-an', '-i', os.path.join(SRC, f)]
            filt.append(f'[{n}:v]null[in{i}_{j}]')
            filt += blur_chain(f'in{i}_{j}', blurs, f'bl{i}_{j}')
            filt.append(f'[bl{i}_{j}]setpts=(PTS-STARTPTS)/{sp},{norm}[p{i}_{j}]')
            parts.append(f'[p{i}_{j}]'); n += 1
        join = 'null' if len(parts) == 1 else f'concat=n={len(parts)}:v=1:a=0,settb=1/{FPS}'
        pad = f',tpad=stop_mode=clone:stop_duration={hold}' if hold else ''
        filt.append(f"{''.join(parts)}{join}{pad}[s{i}]")
        durs.append(sum((b - a) / sp for a, b, sp in segs) + hold); secs.append(sec)
    # captura final: estática
    k = len(SHOTS)
    args += ['-loop', '1', '-framerate', f'{FPS}', '-t', f'{FEED_DUR}', '-i', os.path.join(SRC, FEED)]
    filt.append(f'[{n}:v]{norm}[s{k}]'); n += 1
    durs.append(FEED_DUR); secs.append('feedback')

    cur, acc = 's0', durs[0]
    for i in range(1, len(durs)):
        kind, d = ('fade', XF_IN) if secs[i] == secs[i - 1] else SECTION_XF[(secs[i - 1], secs[i])]
        tr = f"transition=custom:expr='{PUSH}'" if kind == 'push' else 'transition=fade'
        filt.append(f'[{cur}][s{i}]xfade={tr}:duration={d}:offset={acc - d:.4f}[x{i}]')
        cur, acc = f'x{i}', acc + durs[i] - d
    args += ['-loop', '1', '-framerate', f'{FPS}', '-t', f'{acc:.3f}', '-i', os.path.join(SCR, 'frame.png')]
    filt.append(f'[{cur}]format=yuv420p,pad=1080:1920:{SX}:{SY}:color=0x06302a[pd]')
    filt.append(f'[{n}:v]format=rgba[fr]')
    filt.append(f'[pd][fr]overlay=0:0:shortest=1,format=yuv420p[body]')
    return args, filt, acc, n + 1, durs, secs


def main():
    os.makedirs(OUT, exist_ok=True)
    args, filt, body_len, n_in, durs, secs = build_body()
    args += ['-framerate', f'{FPS}', '-i', os.path.join(SCR, 'intro', '%04d.png')]
    args += ['-framerate', f'{FPS}', '-i', os.path.join(SCR, 'outro', '%04d.png')]
    bm = f'scale=1080:1920:out_color_matrix=bt709:out_range=tv,setsar=1,format=yuv420p,settb=1/{FPS}'
    filt.append(f'[{n_in}:v]{bm}[intro]')
    filt.append(f'[{n_in + 1}:v]{bm},fade=t=out:st={OUTRO_DUR - 0.8}:d=0.8[outro]')
    filt.append(f'[body]settb=1/{FPS}[body2]')
    filt.append(f'[intro][body2]xfade=transition=fade:duration={XF_BOOKEND}:offset={INTRO_DUR - XF_BOOKEND}[ib]')
    total = INTRO_DUR + body_len - XF_BOOKEND
    filt.append(f'[ib][outro]xfade=transition=fade:duration={XF_BOOKEND}:offset={total - XF_BOOKEND:.4f}[v]')
    total += OUTRO_DUR - XF_BOOKEND

    # trilha: começo da música + final natural dela (fade original), emendados com crossfade
    music = os.path.join(SRC, 'MOVIVO GUIDE.mp3')
    tail_start, tail_end, xa = 160.5, 168.0, 1.5
    head_len = total - (tail_end - tail_start) + xa
    args += ['-i', music, '-i', music]
    mi = n_in + 2
    filt.append(f'[{mi}:a]atrim=0:{head_len:.3f},asetpts=PTS-STARTPTS[mh]')
    filt.append(f'[{mi + 1}:a]atrim={tail_start}:{tail_end},asetpts=PTS-STARTPTS[mt]')
    filt.append(f'[mh][mt]acrossfade=d={xa}:c1=tri:c2=tri,afade=t=in:d=0.4,atrim=0:{total:.3f}[a]')

    # linha do tempo de cada seção no vídeo final (para casar a narração)
    t = INTRO_DUR - XF_BOOKEND
    print(f'abertura 0.0')
    for i, (d, s) in enumerate(zip(durs, secs)):
        if i == 0 or s != secs[i - 1]:
            print(f'{s:9s} {t:6.1f}')
        nxt = durs and (i + 1 < len(durs)) and (XF_IN if secs[i + 1] == s else SECTION_XF[(s, secs[i + 1])][1])
        t += d - (nxt or 0)
    print(f'encerra.  {total - OUTRO_DUR:6.1f}')
    print(f'corpo: {body_len:.2f}s  total: {total:.2f}s  ({int(total // 60)}:{total % 60:04.1f})')
    graph = os.path.join(SCR, 'graph.txt')
    open(graph, 'w', encoding='utf-8').write(';\n'.join(filt))
    if '--dry' in sys.argv:
        return
    venc = ['-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', f'{FPS}',
            '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
            '-movflags', '+faststart']
    final = os.path.join(OUT, 'movivo-apresentacao.mp4')
    subprocess.run([FF, '-hide_banner', '-y', *args, '-filter_complex_script', graph,
                    '-map', '[v]', '-map', '[a]', *venc, '-c:a', 'aac', '-b:a', '256k', final], check=True)
    # versão sem áudio e trilha separada, para mixar com a narração depois
    subprocess.run([FF, '-hide_banner', '-v', 'error', '-y', '-i', final, '-an', '-c:v', 'copy',
                    os.path.join(OUT, 'movivo-apresentacao-sem-audio.mp4')], check=True)
    subprocess.run([FF, '-hide_banner', '-v', 'error', '-y', '-i', final, '-vn', '-c:a', 'copy',
                    os.path.join(OUT, 'trilha-musical.m4a')], check=True)


if __name__ == '__main__':
    main()
