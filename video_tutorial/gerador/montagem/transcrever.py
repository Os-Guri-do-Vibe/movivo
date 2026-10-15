"""Transcreve a narração com tempo por palavra (base da legenda e do encaixe dos blocos).

Uso:  python video_tutorial/gerador/montagem/transcrever.py "video_tutorial/<narração>.mpeg"
Requer: pip install faster-whisper imageio-ffmpeg   (baixa o modelo "small" na primeira vez)
Saída: video_tutorial/gerador/words2.json  →  [[início, fim, "palavra"], ...]
       e imprime o texto com os tempos, para ajustar BLOCKS em mix.py.
"""
import json, os, subprocess, sys

import numpy as np
from faster_whisper import WhisperModel

FF = os.environ.get('FFMPEG') or __import__('imageio_ffmpeg').get_ffmpeg_exe()
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'words2.json')

pcm = subprocess.run([FF, '-v', 'error', '-i', sys.argv[1], '-ac', '1', '-ar', '16000', '-f', 's16le', '-'],
                     capture_output=True, check=True).stdout
audio = np.frombuffer(pcm, np.int16).astype(np.float32) / 32768
segs, _ = WhisperModel('small', device='cpu', compute_type='int8').transcribe(audio, language='pt', word_timestamps=True)
words = [(round(w.start, 2), round(w.end, 2), w.word.strip()) for s in segs for w in s.words]
json.dump(words, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False)
print(' '.join(f'[{a}]{t}' for a, b, t in words))
