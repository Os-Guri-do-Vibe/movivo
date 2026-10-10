#!/usr/bin/env python3
"""Provisionamento idempotente. Nunca imprime chaves, tokens ou conteúdo de saúde."""
import argparse
import base64
import json
import os
from pathlib import Path
import secrets
import ssl
import subprocess
import tempfile
import time
import urllib.error
import urllib.request


def private_write(path, content):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, temporary = tempfile.mkstemp(dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(content)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def openssl(*args):
    subprocess.run(["openssl", *map(str, args)], check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def certificates(secrets_dir, custody):
    tls = secrets_dir / "internal_tls"
    tls.mkdir(parents=True, exist_ok=True, mode=0o700)
    custody.mkdir(parents=True, exist_ok=True, mode=0o700)
    ca_key = custody / "ca.key"
    ca_cert = tls / "ca.crt"
    if ca_key.exists() != ca_cert.exists():
        raise RuntimeError("Custódia da CA incompleta; restaure o material existente, não regenere.")
    if not ca_key.exists():
        openssl("req", "-x509", "-newkey", "rsa:3072", "-nodes", "-sha256", "-days", "3650",
                "-subj", "/CN=MOVIVO Internal CA", "-keyout", ca_key, "-out", ca_cert,
                "-addext", "basicConstraints=critical,CA:TRUE",
                "-addext", "keyUsage=critical,keyCertSign,cRLSign")
        ca_key.chmod(0o600)
        ca_cert.chmod(0o644)
    for name in ("postgres", "evolution-postgres", "pgbouncer", "redis-master", "redis-replica",
                 "redis-sentinel", "vault", "api", "web", "evolution-api"):
        key, cert = tls / f"{name}.key", tls / f"{name}.crt"
        if key.exists() != cert.exists():
            raise RuntimeError(f"Par TLS incompleto: {name}; restaure antes de continuar.")
        if cert.exists() and subprocess.run(
                ["openssl", "x509", "-checkend", "2592000", "-noout", "-in", str(cert)],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0:
            openssl("verify", "-CAfile", ca_cert, cert)
            continue
        with tempfile.TemporaryDirectory(dir=tls) as temporary:
            tmp = Path(temporary)
            ext = tmp / "extensions"
            ext.write_text("basicConstraints=critical,CA:FALSE\n"
                           "keyUsage=critical,digitalSignature,keyEncipherment\n"
                           "extendedKeyUsage=serverAuth,clientAuth\n"
                           f"subjectAltName=DNS:{name},DNS:localhost,IP:127.0.0.1,IP:::1\n")
            openssl("req", "-new", "-newkey", "rsa:2048", "-nodes", "-sha256",
                    "-subj", f"/CN={name}", "-keyout", tmp / "key", "-out", tmp / "csr")
            openssl("x509", "-req", "-in", tmp / "csr", "-CA", ca_cert, "-CAkey", ca_key,
                    "-set_serial", str(secrets.randbits(128)), "-days", "90", "-sha256",
                    "-extfile", ext, "-out", tmp / "cert")
            private_write(key, (tmp / "key").read_bytes())
            private_write(cert, (tmp / "cert").read_bytes())
            cert.chmod(0o644)
    keyring = secrets_dir / "health_cipher_keyring"
    if not keyring.exists() and (custody / "health-keyring.json").exists():
        raise RuntimeError("Keyring ausente com custódia existente: restaure, não regenere o mesmo ID.")
    if not keyring.exists():
        private_write(keyring, json.dumps({"health-2026-q4": base64.b64encode(
            secrets.token_bytes(32)).decode()}).encode())
        # Parent secrets/ is private; the read-only mount is available only to API.
        keyring.chmod(0o644)
    keyring_custody = custody / "health-keyring.json"
    if keyring_custody.exists() and keyring_custody.read_bytes() != keyring.read_bytes():
        raise RuntimeError("Keyring difere da custódia; valide a rotação antes de continuar.")
    if not keyring_custody.exists():
        private_write(keyring_custody, keyring.read_bytes())
    token = secrets_dir / "vault_token"
    if not token.exists():
        private_write(token, b"not-provisioned")
        token.chmod(0o644)
    print("CA, certificados e chave independente provisionados; valores não exibidos.")


def provision_vault(secrets_dir, custody, snapshot=None):
    context = ssl.create_default_context(cafile=str(secrets_dir / "internal_tls/ca.crt"))
    address = "https://127.0.0.1:8200"

    def request(path, data=None, token=None, binary=False):
        headers = {"Content-Type": "application/json"}
        if token:
            headers["X-Vault-Token"] = token
        req = urllib.request.Request(address + "/v1/" + path,
                                     data=None if data is None else json.dumps(data).encode(),
                                     headers=headers)
        with urllib.request.urlopen(req, context=context, timeout=30) as response:
            content = response.read()
            return content if binary else json.loads(content) if content else {}

    for attempt in range(60):
        try:
            initialized = request("sys/init")["initialized"]
            break
        except (OSError, urllib.error.URLError):
            if attempt == 59:
                raise RuntimeError("Vault TLS indisponível.") from None
            time.sleep(1)
    init_file = custody / "vault-init.json"
    if not initialized:
        if init_file.exists():
            raise RuntimeError("Vault vazio com custódia anterior: restaure o snapshot; não reinicialize.")
        # ponytail: um operador no MVP; distribuir custódia e usar auto-unseal KMS
        # ao migrar para múltiplas instâncias. A custódia nunca é montada na API/Vault.
        initialization = request("sys/init", {"secret_shares": 1, "secret_threshold": 1})
        private_write(init_file, json.dumps(initialization).encode())
    if not init_file.exists():
        raise RuntimeError("Custódia Vault ausente: obtenha a chave de unseal do operador.")
    initialization = json.loads(init_file.read_text())
    request("sys/unseal", {"key": initialization["keys_base64"][0]})
    root_token = initialization["root_token"]
    for attempt in range(30):
        try:
            request("sys/health")
            break
        except urllib.error.HTTPError:
            if attempt == 29:
                raise RuntimeError("Vault não ficou pronto após unseal.") from None
            time.sleep(1)
    if snapshot is not None:
        private_write(snapshot, request("sys/storage/raft/snapshot", token=root_token, binary=True))
        print("Snapshot Vault gravado com modo 0600; custódia não incluída.")
        return
    audit_devices = request("sys/audit", token=root_token)
    if "file/" not in audit_devices:
        request("sys/audit/file", {"type": "file", "options": {"file_path": "stdout",
                "log_raw": "false"}}, root_token)
    mounted = request("sys/mounts", token=root_token)
    if "transit/" not in mounted:
        request("sys/mounts/transit", {"type": "transit"}, root_token)
    request("transit/keys/movivo-health", {"type": "aes256-gcm96"}, root_token)
    request("transit/keys/movivo-health/config", {"auto_rotate_period": "2160h"}, root_token)
    policy = ('path "transit/encrypt/movivo-health" { capabilities = ["update"] }\n'
              'path "transit/decrypt/movivo-health" { capabilities = ["update"] }\n'
              'path "auth/token/renew-self" { capabilities = ["update"] }\n'
              'path "auth/token/lookup-self" { capabilities = ["read"] }\n')
    request("sys/policies/acl/movivo-health", {"policy": policy}, root_token)
    token_file = secrets_dir / "vault_token"
    app_token = token_file.read_text().strip()
    try:
        request("auth/token/renew-self", {}, app_token)
    except urllib.error.HTTPError:
        created = request("auth/token/create", {"policies": ["movivo-health"],
                          "no_default_policy": True, "orphan": True, "period": "24h",
                          "display_name": "movivo-api-transit"}, root_token)
        app_token = created["auth"]["client_token"]
        # Write in place: Docker Secrets bind the inode; replacement requires recreation.
        with token_file.open("w") as stream:
            stream.write(app_token)
        token_file.chmod(0o644)
    capabilities = request("sys/capabilities", {"token": app_token,
                           "paths": ["transit/encrypt/movivo-health", "transit/decrypt/movivo-health",
                                     "sys/mounts", "transit/keys/movivo-health/rotate"]}, root_token)
    if capabilities["sys/mounts"] != ["deny"] or capabilities[
            "transit/keys/movivo-health/rotate"] != ["deny"]:
        raise RuntimeError("Token da API tem privilégios administrativos; recusado.")
    fixture = base64.b64encode(b"movivo-security-synthetic-check").decode()
    encrypted = request("transit/encrypt/movivo-health", {"plaintext": fixture}, app_token)
    decrypted = request("transit/decrypt/movivo-health",
                        {"ciphertext": encrypted["data"]["ciphertext"]}, app_token)
    if decrypted["data"]["plaintext"] != fixture:
        raise RuntimeError("Vault Transit round-trip falhou.")
    print("Vault inicializado/unsealed; Transit validado; token API sem privilégios administrativos.")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--environment", choices=("local", "production"), required=True)
    parser.add_argument("--vault", action="store_true")
    parser.add_argument("--snapshot", type=Path)
    args = parser.parse_args()
    root = args.root.resolve()
    # Na VPS os segredos ficam direto em <root>/secrets; no repo local, em secrets/desenvolvimento.
    secrets_dir = root / ("secrets/desenvolvimento" if args.environment == "local" else "secrets")
    custody = Path.home() / ".local/share/movivo-security" / args.environment
    os.umask(0o077)
    if args.vault:
        provision_vault(secrets_dir, custody, args.snapshot)
    else:
        certificates(secrets_dir, custody)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Driver/API exceptions may contain credentials; never print their causes.
        diagnosis = str(error) if isinstance(error, RuntimeError) else type(error).__name__
        if isinstance(error, urllib.error.HTTPError):
            diagnosis += f" (HTTP {error.code})"
        raise SystemExit(f"Provisionamento interrompido: {diagnosis}. Preserve a custódia.")
