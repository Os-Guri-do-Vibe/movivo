"""Monta a versão "estúdio" do vídeo (takes gravados pelo Playwright) na moldura 1080x1920."""
import os, subprocess, sys

import make_video as mv

TAKES = os.path.join(mv.SCR, '..', 'studio', 'takes')
# --legenda: moldura a 86% e mais alta, faixa de legenda embaixo, saída em render/legendado/
CAPTION = '--legenda' in sys.argv
OUTDIR = os.path.join(mv.OUT, 'legendado') if CAPTION else mv.OUT
FRAME = os.path.join(mv.SCR, 'frame_cap.png' if CAPTION else 'frame.png')
STATUSBAR = os.path.join(mv.SCR, '..', 'studio', 'statusbar-{}.png')
CLOCK = {'anamnese': '1447', 'checkin': '1939'}   # horário do celular coerente com as mensagens

# (seção, take, tipo, [(início, fim, velocidade), ...]) — trechos do mesmo take são contínuos
import json as _json
M = {t: _json.load(open(os.path.join(TAKES, t, 'marks.json'), encoding='utf-8'))
     for t in ('anamnese', 'wa1', 'wa2', 'wa3', 'checkin')}
A, W1, CK = M['anamnese'], M['wa1'], M['checkin']
# cortes ancorados nas marcações gravadas por cada take (sobrevivem a uma regravação)
SHOTS = [
    ('anam', 'anamnese', 'web', [(0.0, A['cta'] + 0.23, 1.15, 0.4),          # landing: segura o toque no CTA
                                 (A['anamnese'] + 0.31, A['notif'] - 0.4, 1.6),  # dados pessoais + WhatsApp
                                 (A['notif'] - 0.4, A['notif'] + 3.4, 1.0),      # notificação do código
                                 (A['notif'] + 3.4, A['consents'], 1.7),         # código + e-mail
                                 (A['consents'], A['objetivos'], 1.4),           # desce com calma, consentimentos
                                 (A['objetivos'], A['dores'], 1.9),              # objetivos, histórico, rotina
                                 (A['dores'], A['parq'], 1.6),                   # dores, preferências
                                 (A['parq'], A['parq-q3'], 1.4),                 # PAR-Q: intro + dois "Não"
                                 (A['parq-q3'], A['parq-q6'], 3.5),              # avança
                                 (A['parq-q6'], A['parq-q7'], 1.3),              # "Sim" com comentário
                                 (A['parq-q7'], A['confirmar'], 3.5),            # avança
                                 (A['confirmar'], A['finalizar'] + 0.12, 1.5, 0.3),  # confirmar
                                 (A['pronto'] - 0.25, A['pronto'] + 7.8, 1.2)]),  # tela final do topo ao Club
    ('wa1', 'wa1', 'wa', [(0.0, W1['abre-pdf'], 1.25), (W1['abre-pdf'], W1['audio'], 1.2),
                          (W1['audio'], W1['resposta'] + 8.15, 1.15)]),
    ('wa2', 'wa2', 'wa', [(0.0, M['wa2']['toque-link'] + 0.95, 1.0)]),
    ('check', 'checkin', 'web', [(0.0, CK['iniciado'], 1.25), (CK['iniciado'], CK['finalizar'], 2.0),
                                 (CK['finalizar'], CK['concluido'], 1.4), (CK['concluido'], CK['zoom'] + 3.45, 1.0)]),
    ('wa3', 'wa3', 'wa', [(0.0, M['wa3']['feedback'] + 9.6, 1.0)]),
]
SECTION_XF = {
    ('anam', 'wa1'): ('push', 0.8),
    ('wa1', 'wa2'): ('fade', 0.6),
    ('wa2', 'check'): ('push', 0.8),
    ('check', 'wa3'): ('push', 0.8),
}
# efeitos sonoros: (take, instante na fonte, arquivo)
SFX = [('anamnese', A['notif'] + 0.08, os.path.join(mv.SCR, 'ding.wav'))]


def video_time(take, src_t):
    """Converte um instante de um take para o tempo no vídeo final."""
    t = mv.INTRO_DUR - mv.XF_BOOKEND
    for i, (sec, tk, kind, segs) in enumerate(SHOTS):
        local = 0.0
        for a, b, sp, *hold in segs:
            if tk == take and a <= src_t <= b:
                return t + local + (src_t - a) / sp
            local += (b - a) / sp + (hold[0] if hold else 0)
        if i + 1 < len(SHOTS):
            t += local - SECTION_XF[(sec, SHOTS[i + 1][0])][1]
    raise ValueError((take, src_t))




def build_body():
    args, filt, durs = [], [], []
    norm = f'fps={mv.FPS},setsar=1,format=yuv444p,settb=1/{mv.FPS}'
    n = 0
    for i, (sec, take, kind, segs) in enumerate(SHOTS):
        src = os.path.join(TAKES, take, f'{take}.mp4')
        parts = []
        for j, (a, b, sp, *hold) in enumerate(segs):
            args += ['-ss', f'{a}', '-t', f'{b - a}', '-i', src]
            freeze = f',tpad=stop_mode=clone:stop_duration={hold[0]}' if hold else ''
            filt.append(f'[{n}:v]setpts=(PTS-STARTPTS)/{sp},{norm}{freeze}[p{i}_{j}]')
            parts.append(f'[p{i}_{j}]'); n += 1
        join = 'null' if len(parts) == 1 else f'concat=n={len(parts)}:v=1:a=0,settb=1/{mv.FPS}'
        filt.append(f"{''.join(parts)}{join}[j{i}]")
        dur = sum((x[1] - x[0]) / x[2] + (x[3] if len(x) > 3 else 0) for x in segs)
        if kind == 'web':
            # barra de status do iOS em cima da página (o take web não tem)
            args += ['-loop', '1', '-framerate', f'{mv.FPS}', '-t', f'{dur:.3f}', '-i', STATUSBAR.format(CLOCK[take])]
            filt.append(f'[j{i}]pad={mv.SW}:{mv.SH}:0:112[pd{i}]')
            filt.append(f'[{n}:v]format=rgba[sb{i}]')
            filt.append(f'[pd{i}][sb{i}]overlay=0:0:shortest=1,{norm}[s{i}]')
            n += 1
        else:
            filt.append(f'[j{i}]crop={mv.SW}:{mv.SH}:0:0,{norm}[s{i}]')
        durs.append(dur)

    cur, acc = 's0', durs[0]
    for i in range(1, len(durs)):
        kind, d = SECTION_XF[(SHOTS[i - 1][0], SHOTS[i][0])]
        tr = f"transition=custom:expr='{mv.PUSH}'" if kind == 'push' else 'transition=fade'
        filt.append(f'[{cur}][s{i}]xfade={tr}:duration={d}:offset={acc - d:.4f}[x{i}]')
        cur, acc = f'x{i}', acc + durs[i] - d
    args += ['-loop', '1', '-framerate', f'{mv.FPS}', '-t', f'{acc:.3f}', '-i', FRAME]
    place = 'scale=714:1546:flags=lanczos,pad=1080:1920:183:52' if CAPTION else f'pad=1080:1920:{mv.SX}:{mv.SY}'
    filt.append(f'[{cur}]format=yuv420p,{place}:color=0x06302a[pd]')
    filt.append(f'[{n}:v]format=rgba[fr]')
    filt.append('[pd][fr]overlay=0:0:shortest=1,format=yuv420p[body]')
    return args, filt, acc, n + 1, durs


def main():
    args, filt, body_len, n_in, durs = build_body()
    I, O, XB = mv.INTRO_DUR, mv.OUTRO_DUR, mv.XF_BOOKEND
    args += ['-framerate', f'{mv.FPS}', '-i', os.path.join(mv.SCR, 'intro', '%04d.png')]
    args += ['-framerate', f'{mv.FPS}', '-i', os.path.join(mv.SCR, 'outro', '%04d.png')]
    bm = f'scale=1080:1920:out_color_matrix=bt709:out_range=tv,setsar=1,format=yuv420p,settb=1/{mv.FPS}'
    filt.append(f'[{n_in}:v]{bm}[intro]')
    filt.append(f'[{n_in + 1}:v]{bm},fade=t=out:st={O - 0.8}:d=0.8[outro]')
    filt.append(f'[body]settb=1/{mv.FPS}[body2]')
    filt.append(f'[intro][body2]xfade=transition=fade:duration={XB}:offset={I - XB}[ib]')
    total = I + body_len - XB
    total += O - XB
    filt.append(f'[ib][outro]xfade=transition=fade:duration={XB}:offset={total - O:.4f}' + ('[v0]' if CAPTION else '[v]'))
    if CAPTION:
        # trilha de legenda: imagens transparentes com a duração de cada estado
        import json
        st = json.load(open(os.path.join(mv.SCR, 'caption_states.json'), encoding='utf-8'))
        caps = os.path.join(mv.SCR, 'caps')
        lines, t = [], 0.0
        for i, (a, b, _, _) in enumerate(st):
            if a > t + 0.001:
                lines += [f"file '{caps}/empty.png'", f'duration {a - t:.3f}']
            lines += [f"file '{caps}/{i:04d}.png'", f'duration {b - a:.3f}']
            t = b
        lines += [f"file '{caps}/empty.png'", f'duration {total - t:.3f}', f"file '{caps}/empty.png'"]
        lst = os.path.join(mv.SCR, 'caps.txt')
        open(lst, 'w').write('\n'.join(lines).replace('\\', '/'))
        args += ['-f', 'concat', '-safe', '0', '-i', lst]
        ci = n_in + 2
        filt.append(f'[{ci}:v]fps={mv.FPS},format=rgba,settb=1/{mv.FPS}[cap]')
        filt.append('[v0][cap]overlay=0:1615:shortest=0:eof_action=pass,format=yuv420p[v]')

    music = os.path.join(mv.SRC, 'MOVIVO GUIDE.mp3')
    tail_start, tail_end, xa = 160.5, 168.0, 1.5
    head_len = total - (tail_end - tail_start) + xa
    args += ['-i', music, '-i', music]
    mi = n_in + 2 + (1 if CAPTION else 0)
    filt.append(f'[{mi}:a]atrim=0:{head_len:.3f},asetpts=PTS-STARTPTS[mh]')
    filt.append(f'[{mi + 1}:a]atrim={tail_start}:{tail_end},asetpts=PTS-STARTPTS[mt]')
    filt.append(f'[mh][mt]acrossfade=d={xa}:c1=tri:c2=tri,afade=t=in:d=0.4,atrim=0:{total:.3f}[mus]')
    si = mi + 2
    fx = []
    for k, (take, src_t, wav) in enumerate(SFX):
        args += ['-i', wav]
        vt = video_time(take, src_t)
        print(f'efeito {os.path.basename(wav)} em {vt:.2f}s')
        filt.append(f'[{si + k}:a]aresample=48000,volume=1.6,adelay={int(vt * 1000)}:all=1[fx{k}]')
        fx.append(f'[fx{k}]')
    filt.append(f"[mus]{''.join(fx)}amix=inputs={1 + len(fx)}:normalize=0:duration=first[a]")

    # linha do tempo: início de cada trecho no vídeo final (para casar a narração)
    t = I - XB
    for i, (sec, take, kind, segs) in enumerate(SHOTS):
        local = 0.0
        for a, b, sp, *hold in segs:
            print(f'{sec:6s} {take:9s} fonte {a:6.2f}  -> video {t + local:6.1f}')
            local += (b - a) / sp + (hold[0] if hold else 0)
        if i + 1 < len(SHOTS):
            t += durs[i] - SECTION_XF[(sec, SHOTS[i + 1][0])][1]
    print(f'encerramento {total - O:6.1f}')
    print(f'corpo: {body_len:.2f}s  total: {total:.2f}s  ({int(total // 60)}:{total % 60:04.1f})')
    graph = os.path.join(mv.SCR, 'graph_studio.txt')
    open(graph, 'w', encoding='utf-8').write(';\n'.join(filt))
    if '--dry' in sys.argv:
        return
    venc = ['-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', f'{mv.FPS}',
            '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
            '-movflags', '+faststart']
    os.makedirs(OUTDIR, exist_ok=True)
    final = os.path.join(OUTDIR, 'movivo-apresentacao.mp4')
    subprocess.run([mv.FF, '-hide_banner', '-y', *args, '-filter_complex_script', graph,
                    '-map', '[v]', '-map', '[a]', *venc, '-c:a', 'aac', '-b:a', '256k', final], check=True)
    subprocess.run([mv.FF, '-hide_banner', '-v', 'error', '-y', '-i', final, '-an', '-c:v', 'copy',
                    os.path.join(OUTDIR, 'movivo-apresentacao-sem-audio.mp4')], check=True)
    subprocess.run([mv.FF, '-hide_banner', '-v', 'error', '-y', '-i', final, '-vn', '-c:a', 'copy',
                    os.path.join(OUTDIR, 'trilha-musical.m4a')], check=True)


if __name__ == '__main__':
    main()
