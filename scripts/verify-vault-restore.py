#!/usr/bin/env python3
"""Verify Transit recovery in disposable, network-isolated Raft storage.

Reads live Vault and operator custody; never changes live keys or restores live storage.
An existing snapshot is preserved and must contain Transit key version 1 (retained for recovery).
"""
import argparse
import base64
import json
import os
from pathlib import Path
import ssl
import subprocess
import time
import urllib.request
import uuid


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--environment", choices=("local", "production"), default="local")
    parser.add_argument("--snapshot", type=Path)
    args = parser.parse_args()
    root = args.root.resolve()
    custody = Path.home() / ".local/share/movivo-security" / args.environment / "vault-init.json"
    scratch = "movivo-restore-check-" + uuid.uuid4().hex
    stage = "preflight"
    started = False

    def run(arguments, data=None, allowed=(0,)):
        result = subprocess.run(arguments, input=data, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, timeout=60)
        if result.returncode not in allowed:
            message = result.stderr.decode(errors="replace").lower()
            reason = next((reason for reason in ("connection refused", "invalid key", "permission denied", "sealed", "no such file", "failed to decrypt", "internal error", "invalid nonce") if reason in message), "command rejected")
            raise RuntimeError(reason)
        return result.stdout

    def cli(*arguments, authenticated=False, allowed=(0,)):
        command = ["docker", "exec", "-e", "VAULT_ADDR=http://127.0.0.1:8200", scratch]
        if authenticated:
            command += ["sh", "-c", 'export VAULT_TOKEN="$(cat /tmp/operator-token)"; exec vault "$@"',
                        "vault", *arguments]
        else:
            command += ["vault", *arguments]
        return run(command, allowed=allowed)

    def put(name, value):
        # These paths are static; secrets travel only through stdin into private tmpfs.
        run(["docker", "exec", "-i", scratch, "sh", "-c",
             "umask 077; cat > /tmp/" + name],
            value if isinstance(value, bytes) else value.encode())

    try:
        if custody.stat().st_mode & 0o077:
            raise RuntimeError("custody permissions unsafe")
        initialization = json.loads(custody.read_text())
        app_token = (root / "secrets/vault_token").read_text().strip()
        context = ssl.create_default_context(cafile=str(root / "secrets/internal_tls/ca.crt"))

        def live(path, token, data=None, binary=False):
            request = urllib.request.Request("https://127.0.0.1:8200/v1/" + path,
                headers={"X-Vault-Token": token, "Content-Type": "application/json"},
                data=None if data is None else json.dumps(data).encode())
            with urllib.request.urlopen(request, context=context, timeout=30) as response:
                content = response.read()
                return content if binary else json.loads(content)

        stage = "live fixture and snapshot"
        fixture = base64.b64encode(os.urandom(48)).decode()
        ciphertext = live("transit/encrypt/movivo-health", app_token,
                          {"plaintext": fixture, "key_version": 1})["data"]["ciphertext"]
        snapshot = args.snapshot.read_bytes() if args.snapshot else live(
            "sys/storage/raft/snapshot", initialization["root_token"], binary=True)
        image = run(["docker", "inspect", "movivo-vault", "--format", "{{.Config.Image}}"]).decode().strip()
        stage = "isolated scratch startup"
        config = ('disable_mlock = true\napi_addr = "http://127.0.0.1:8200"\n'
                  'cluster_addr = "http://127.0.0.1:8201"\n'
                  'storage "raft" { path = "/vault/data" node_id = "restore-check" }\n'
                  'listener "tcp" { address = "127.0.0.1:8200" tls_disable = true }\n')
        # No host mounts, published ports or persistent volumes. HTTP is isolated loopback.
        run(["docker", "run", "-d", "--name", scratch, "--network", "none",
             "--read-only", "--user", "0:0", "--cap-drop", "ALL", "--memory", "512m",
             "--tmpfs", "/tmp:rw,noexec,nosuid,size=64m",
             "--tmpfs", "/vault/data:rw,noexec,nosuid,size=256m",
             "--tmpfs", "/vault/file:rw,noexec,nosuid,size=16m",
             "--tmpfs", "/vault/logs:rw,noexec,nosuid,size=16m",
             "--entrypoint", "sh", image, "-c",
             "printf '%s' '" + config + "' > /tmp/restore.hcl; exec vault server -config=/tmp/restore.hcl"])
        started = True
        for attempt in range(30):
            try:
                json.loads(cli("status", "-format=json", allowed=(0, 2)))
                break
            except (RuntimeError, json.JSONDecodeError):
                if attempt == 29:
                    raise
                time.sleep(1)
        scratch_init = json.loads(cli("operator", "init", "-key-shares=1", "-key-threshold=1", "-format=json"))
        put("unseal-key", scratch_init["unseal_keys_b64"][0])
        cli("write", "-format=json", "sys/unseal", "key=@/tmp/unseal-key")
        put("operator-token", scratch_init["root_token"])
        put("restore.snap", snapshot)
        put("fixture-cipher", ciphertext)
        stage = "force restore into scratch"
        cli("operator", "raft", "snapshot", "restore", "-force", "/tmp/restore.snap", authenticated=True)
        for attempt in range(30):
            status = json.loads(cli("status", "-format=json", allowed=(0, 2)))
            if status["sealed"]:
                break
            if attempt == 29:
                raise RuntimeError("restore did not seal")
            time.sleep(1)
        stage = "original custody unseal"
        for key in initialization["keys_base64"]:
            put("unseal-key", key)
            for attempt in range(30):
                try:
                    cli("write", "-format=json", "sys/unseal", "key=@/tmp/unseal-key")
                    status = json.loads(cli("status", "-format=json", allowed=(0, 2)))
                    break
                except RuntimeError:
                    if attempt == 29:
                        raise
                    time.sleep(1)
            if not status["sealed"]:
                break
        if status["sealed"]:
            raise RuntimeError("original quorum insufficient")
        put("operator-token", initialization["root_token"])
        stage = "restored app policy token"
        for attempt in range(30):
            try:
                restored_token = json.loads(cli("write", "-format=json", "auth/token/create",
                    "policies=movivo-health", "no_default_policy=true", "orphan=true", "period=24h",
                    authenticated=True))["auth"]["client_token"]
                break
            except RuntimeError:
                if attempt == 29:
                    raise
                time.sleep(1)
        put("operator-token", restored_token)
        stage = "restored Transit fixture decrypt"
        for attempt in range(30):
            try:
                decrypted = json.loads(cli("write", "-format=json", "transit/decrypt/movivo-health",
                    "ciphertext=@/tmp/fixture-cipher", authenticated=True))["data"]["plaintext"]
                break
            except RuntimeError:
                if attempt == 29:
                    raise
                time.sleep(1)
        if decrypted != fixture:
            raise RuntimeError("fixture mismatch")
        print(json.dumps({"passed": True, "environment": args.environment,
            "snapshot": "provided" if args.snapshot else "fresh",
            "image": image, "isolated_network": True, "storage": "tmpfs",
            "original_unseal_and_app_acl": True, "transit_fixture_roundtrip": True}))
    except Exception as error:
        # Driver responses can contain tokens, ciphertext or operator material.
        print(json.dumps({"passed": False, "stage": stage, "reason": str(error) if isinstance(error, RuntimeError) else type(error).__name__}))
        return 1
    finally:
        if started:
            try:
                run(["docker", "rm", "-f", "-v", scratch])
            except Exception:
                print(json.dumps({"cleanup_failed": True, "scratch_container": scratch}))
                return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
