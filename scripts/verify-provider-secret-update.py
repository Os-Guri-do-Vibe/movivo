#!/usr/bin/env python3
"""Valida provisionamento sem rede nem credencial real."""
import contextlib
import io
import os
import pathlib
import sys
import tempfile
import urllib.error
from unittest.mock import patch

source = pathlib.Path('infra/vps/update-provider-secret.sh').read_text()
validation = source.split("<<'PY'\n", 1)[1].split('\nPY\n', 1)[0]
canary = 'security-selfcheck-secret-canary'


class Response:
    status = 200

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass


def check(name, value, config='', fail=False, expected=None):
    with tempfile.TemporaryDirectory() as directory:
        previous = os.getcwd()
        os.chdir(directory)
        try:
            pathlib.Path('api.env').write_text(config)
            pathlib.Path('candidate').write_text(value)
            output = io.StringIO()
            error = None
            with patch.object(sys, 'argv', ['validation', name, 'candidate']), \
                    patch('urllib.request.OpenerDirector.open', side_effect=urllib.error.URLError('denied') if fail else None, return_value=Response()) as request, \
                    contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
                try:
                    namespace = {}
                    exec(compile(validation, 'provider-validation', 'exec'), namespace)
                    assert namespace['NoRedirect']().redirect_request(None, None, 302, '', {}, 'https://untrusted.invalid') is None
                except SystemExit as exception:
                    error = str(exception)
            assert canary not in output.getvalue()
            if expected:
                assert error and expected in error, error
            else:
                assert error is None, error
                assert pathlib.Path('candidate').read_text() == value.rstrip('\r\n') + '\n'
                assert request.call_args.args[0].full_url.startswith('https://')
            if config == 'ASAAS_API_URL=https://api.asaas.com/v3':
                request.assert_not_called()
        finally:
            os.chdir(previous)


for name in ['asaas_api_key', 'openai_api_key', 'anthropic_api_key', 'deepseek_api_key', 'groq_api_key']:
    check(name, canary + '\n')
check('asaas_api_key', canary, 'ASAAS_API_URL=https://api.asaas.com/v3', expected='Sandbox')
check('openai_api_key', canary, fail=True, expected='nenhuma substituição')
check('openai_api_key', canary + ' invalid', expected='formato inválido')
print('provider secrets: cinco fornecedores, Sandbox e falha antes da substituição validados')
