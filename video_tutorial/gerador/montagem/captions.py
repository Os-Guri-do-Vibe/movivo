"""Gera os estados da legenda (palavra a palavra) a partir da transcrição + encaixe dos blocos."""
import json, os

import mix

HERE = os.path.dirname(os.path.abspath(__file__))
WORDS = json.load(open(os.path.join(HERE, '..', 'words2.json'), encoding='utf-8'))
FIX = {'CRAF,': 'CREF,', 'coach': 'Coach', 'coach,': 'Coach,', 'Movivo,': 'Movivo:', 'Leo': 'Léo', 'Leo,': 'Léo,', 'Leo.': 'Léo.'}
MAX_CHARS = 38


def words_in_video():
    out = []
    for name, a, b, at in mix.BLOCKS:
        if name.startswith('6'):
            continue                      # encerramento: o texto já está na tela
        for s, e, w in WORDS:
            if a - 0.3 <= s < b - 0.1:          # timestamps do Whisper adiantam um pouco
                w = FIX.get(w, w)
                if w.startswith('-') and out:          # "check" + "-in"
                    out[-1]['w'] += w; out[-1]['e'] = at + e - a; continue
                if out and out[-1]['w'].lower() == 'educação' and w.lower().startswith('física'):
                    out[-1]['w'] = 'Educação'; w = 'F' + w[1:]
                out.append({'w': w, 's': round(at + s - a, 3), 'e': round(at + e - a, 3), 'blk': name})
    return out


def chunks(words):
    """Quebra por frase; frase longa vira partes de tamanho equilibrado (sem palavra órfã)."""
    sentences, cur = [], []
    for i, w in enumerate(words):
        cur.append(w)
        nxt = words[i + 1] if i + 1 < len(words) else None
        if not nxt or w['w'][-1] in '.?!:' or nxt['blk'] != w['blk']:
            sentences.append(cur); cur = []
    res = []
    for sent in sentences:
        total = len(' '.join(x['w'] for x in sent))
        n = -(-total // MAX_CHARS)
        if n <= 1:
            res.append(sent); continue
        target = total / n
        part, acc = [], 0
        for i, w in enumerate(sent):
            part.append(w); acc += len(w['w']) + 1
            left = sent[i + 1:]
            comma_ok = w['w'].endswith(',') and acc >= target * 0.6
            if left and len(res) < 10**6 and (acc >= target or comma_ok) and len(left) >= 2:
                res.append(part); part, acc = [], 0
        if part:
            res.append(part)
    return res


def states():
    """[(início, fim, palavras, índice destacado)] — sem buracos curtos entre frases."""
    cs = chunks(words_in_video())
    st = []
    for ci, c in enumerate(cs):
        start = c[0]['s'] - 0.08
        nxt_start = cs[ci + 1][0]['s'] - 0.08 if ci + 1 < len(cs) else 1e9
        end = c[-1]['e'] + 0.35
        if nxt_start - end < 0.5:
            end = nxt_start
        for k, w in enumerate(c):
            ks = start if k == 0 else w['s']
            ke = c[k + 1]['s'] if k + 1 < len(c) else end
            st.append((round(ks, 3), round(ke, 3), [x['w'] for x in c], k))
    return st


if __name__ == '__main__':
    import sys
    if '--json' in sys.argv:
        json.dump(states(), open(os.path.join(HERE, 'caption_states.json'), 'w', encoding='utf-8'), ensure_ascii=False)
        print(len(states()), 'estados'); sys.exit()
    for c in chunks(words_in_video()):
        print(f"{c[0]['s']:7.2f}  {' '.join(x['w'] for x in c)}")
