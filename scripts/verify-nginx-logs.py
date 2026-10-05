#!/usr/bin/env python3
"""Self-check de confiança: segredo arbitrário nunca atravessa o coletor."""
import json
import pathlib
import subprocess

script = pathlib.Path(__file__).resolve().parents[1] / 'infra/nginx/sanitize-error.awk'
canary = 'CANARY-CREDENCIAL-NAO-DEVE-SAIR'
lines = [
    f'2026/10/05 22:00:00 [error] 12#12: *42 connect() failed (111: Connection refused), request: "GET /{canary} HTTP/1.1", upstream: "http://{canary}"',
    f'2026/10/05 22:00:01 [warn] 12#12: *43 upstream timed out (110: Connection timed out), client: {canary}',
    f'2026/10/05 22:00:02 [crit] 12#12: SSL_do_handshake() failed: {canary}',
    f'2026/10/05 22:00:03 [error] 12#12: open() "/data/{canary}" failed (2: No such file)',
    f'unknown error with untrusted content "{canary}"',
    f'\n{canary}\n{{"token":"{canary}"}}',
]
result = subprocess.run(['awk', '-f', str(script)], input='\n'.join(lines), text=True, capture_output=True, check=True)
assert canary not in result.stdout + result.stderr
rows = [json.loads(line) for line in result.stdout.splitlines()]
assert len(rows) == 8
assert rows[0]['event'] == 'upstream_connection_failed' and rows[0]['errno'] == 111
assert rows[0]['connection'] == 42
assert rows[1]['event'] == 'upstream_timeout' and rows[1]['severity'] == 'warn'
assert rows[2]['event'] == 'tls_handshake_failed' and rows[2]['severity'] == 'crit'
assert rows[3]['event'] == 'filesystem_error'
assert rows[-1]['event'] == 'nginx_error' and rows[-1]['timestamp'] is None
print('nginx logs: categorias e errno preservados; segredo/contexto bruto ausentes')
