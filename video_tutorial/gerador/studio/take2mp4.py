"""Converte um take do estúdio (quadros do screencast com timestamp) num MP4 30fps de taxa constante."""
import json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
FF = os.environ.get('FFMPEG') or __import__('imageio_ffmpeg').get_ffmpeg_exe()   # pip install imageio-ffmpeg


def convert(name):
    d = os.path.join(HERE, 'takes', name)
    take = json.load(open(os.path.join(d, 'take.json')))
    frames = take['frames']
    t_first = frames[0]['t']
    lines = []
    for i, f in enumerate(frames):
        nxt = frames[i + 1]['t'] if i + 1 < len(frames) else take['t1']
        lines.append(f"file 'f/{f['file']}'\nduration {max(nxt - f['t'], 0.001):.4f}")
    lines.append(f"file 'f/{frames[-1]['file']}'")
    lst = os.path.join(d, 'list.txt')
    open(lst, 'w').write('\n'.join(lines))
    out = os.path.join(d, f'{name}.mp4')
    subprocess.run([FF, '-hide_banner', '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', lst,
                    '-vf', 'fps=30,scale=830:-2:flags=lanczos,format=yuv420p', '-c:v', 'libx264', '-crf', '14',
                    '-preset', 'medium', out], check=True)
    dur = take['t1'] - t_first
    marks = {m['label']: round(m['t'] - t_first, 2) for m in take['marks']}
    print(f'{name}: {len(frames)} quadros, {dur:.1f}s, {len(frames) / dur:.1f} qps médios')
    print(json.dumps(marks, ensure_ascii=False))
    json.dump(marks, open(os.path.join(d, 'marks.json'), 'w'), ensure_ascii=False, indent=1)


if __name__ == '__main__':
    for n in sys.argv[1:]:
        convert(n)
