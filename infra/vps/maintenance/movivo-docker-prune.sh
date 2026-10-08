#!/usr/bin/env bash
# Remove cache e imagens Docker sem uso; volumes e containers ficam intactos.
# Tags antigas de movivo-api/movivo-web são removidas, preservando a versão atual,
# a anterior (rollback) e qualquer imagem referenciada por container, mesmo parado.
# Uso: movivo-docker-prune.sh [--dry-run]
set -euo pipefail

readonly REGISTRY=ghcr.io/os-guri-do-vibe
readonly RETENTION=168h
# Imagem recém-construída pode ter sido baixada por um deploy ainda sem .env atualizado.
readonly GRACE_SECONDS="${MOVIVO_PRUNE_GRACE_SECONDS:-7200}"

# stdin: linhas "P <id>" (protegidos) e depois "I <ref> <id> <criada_epoch> <bytes>".
# stdout: "KEEP <ref> <motivo>", "REMOVE <ref> <id> <bytes>" e "ESTIMATE <bytes> <imagens>".
# Tags de um mesmo ID compartilham decisão; o estimado conta cada ID uma única vez
# e é teto: camadas compartilhadas com imagens mantidas não são liberadas.
select_images() {
  local current="$1" previous="$2" now="$3" grace="$4"
  awk -v cur="$current" -v prev="$previous" -v now="$now" -v grace="$grace" -v scope="${REGISTRY}/movivo-" '
    $1 == "P" { protectedId[$2] = 1; next }
    $1 == "I" {
      ref = $2; id = $3; created = $4; bytes = $5; tag = ref; sub(/^.*:/, "", tag)
      if (index(ref, scope) != 1)         { print "KEEP", ref, "fora-do-escopo" }
      else if (tag == cur)                { print "KEEP", ref, "versao-atual" }
      else if (prev != "" && tag == prev) { print "KEEP", ref, "versao-anterior" }
      else if (id in protectedId)         { print "KEEP", ref, "em-uso-ou-mesmo-id-protegido" }
      else if (now - created < grace)     { print "KEEP", ref, "recente" }
      else {
        print "REMOVE", ref, id, bytes
        if (!(id in counted)) { counted[id] = 1; total += bytes; images++ }
      }
    }
    END { print "ESTIMATE", total + 0, images + 0 }'
}

fail() { echo "[movivo/docker-prune] ERRO: $*" >&2; exit 1; }

prune_versioned_images() {
  local dry_run="$1" env_file="${MOVIVO_ENV_FILE:-/opt/movivo/.env}"
  local current previous repo ref id version created bytes containers
  [[ -r "$env_file" ]] || fail "não consegui ler ${env_file}"
  current="$(sed -n 's/^MOVIVO_VERSION=//p' "$env_file")"
  previous="$(sed -n 's/^MOVIVO_PREVIOUS_VERSION=//p' "$env_file")"
  [[ "$current" =~ ^[0-9a-f]{7,40}$ ]] || fail "MOVIVO_VERSION ausente ou inválida em ${env_file}"
  [[ -z "$previous" || "$previous" =~ ^[0-9a-f]{7,40}$ ]] || fail "MOVIVO_PREVIOUS_VERSION inválida em ${env_file}"

  local input=""

  for repo in movivo-api movivo-web; do
    docker image inspect "${REGISTRY}/${repo}:${current}" >/dev/null 2>&1 \
      || fail "imagem atual ${REGISTRY}/${repo}:${current} não existe localmente"
    for version in "$current" $previous; do
      id="$(docker image inspect --format '{{.Id}}' "${REGISTRY}/${repo}:${version}" 2>/dev/null || true)"
      if [[ -n "$id" ]]; then
        input+="P ${id}"$'\n'
      else
        echo "[movivo/docker-prune] aviso: ${repo}:${version} ausente localmente" >&2
      fi
    done
  done

  containers="$(docker ps -aq)"
  if [[ -n "$containers" ]]; then
    # shellcheck disable=SC2086
    input+="$(docker inspect --format 'P {{.Image}}' $containers)"$'\n'
  fi

  for repo in movivo-api movivo-web; do
    while read -r ref; do
      [[ -n "$ref" && "$ref" != *:'<none>' ]] || continue
      read -r id created bytes < <(docker image inspect --format '{{.Id}} {{.Created}} {{.Size}}' "$ref")
      input+="I ${ref} ${id} $(date -d "$created" +%s) ${bytes}"$'\n'
    done < <(docker image ls --no-trunc --filter "reference=${REGISTRY}/${repo}" --format '{{.Repository}}:{{.Tag}}')
  done

  local report failures=0
  report="$(select_images "$current" "$previous" "$(date +%s)" "$GRACE_SECONDS" <<<"$input")"

  echo "[movivo/docker-prune] versão atual=${current} anterior=${previous:-<nenhuma>}"
  echo "[movivo/docker-prune] containers e imagens referenciadas:"
  docker ps -a --format '  {{.Names}} -> {{.Image}}'
  echo "[movivo/docker-prune] tags mantidas:"
  awk '$1 == "KEEP" && $3 != "fora-do-escopo" { print "  " $2 " (" $3 ")" }' <<<"$report"
  echo "[movivo/docker-prune] tags a remover:"
  awk '$1 == "REMOVE" { print "  " $2 }' <<<"$report"
  awk '$1 == "ESTIMATE" { printf "[movivo/docker-prune] teto lógico de %.2f GB em %d imagens (camadas compartilhadas são recontadas; o real está em docker system df)\n", $2 / 1e9, $3 }' <<<"$report"

  if [[ "$dry_run" == 1 ]]; then
    echo "[movivo/docker-prune] --dry-run: nada foi removido"
    return 0
  fi

  while read -r ref; do
    # Remove só a tag; o Docker recusa apagar imagem em uso por container.
    docker rmi "$ref" >/dev/null || { echo "[movivo/docker-prune] falha ao remover ${ref}" >&2; failures=$((failures + 1)); }
  done < <(awk '$1 == "REMOVE" { print $2 }' <<<"$report")
  [[ $failures -eq 0 ]] || fail "${failures} tag(s) não removidas"
}

main() {
  local dry_run=0
  case "${1:-}" in
    --dry-run) dry_run=1 ;;
    "") ;;
    *) echo "uso: $0 [--dry-run]" >&2; exit 2 ;;
  esac

  echo "[movivo/docker-prune] antes"
  docker system df

  prune_versioned_images "$dry_run"
  [[ "$dry_run" == 0 ]] || return 0

  # Cache sem uso pode ser reconstruído pelo BuildKit. A retenção de sete dias
  # evita jogar fora o cache dos deploys recentes.
  docker builder prune --all --force --filter "until=${RETENTION}"

  # Sem --all: remove apenas imagens dangling; nunca imagens de infraestrutura.
  docker image prune --force --filter "until=${RETENTION}"

  echo "[movivo/docker-prune] depois"
  docker system df
}

[[ "${BASH_SOURCE[0]}" != "$0" ]] || main "$@"
