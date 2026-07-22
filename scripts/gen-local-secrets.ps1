<#
.SYNOPSIS
  MOVIVO - Gerador de Docker Secrets para o ambiente LOCAL (equivalente nativo
  Windows de scripts/gen-local-secrets.sh).

.DESCRIPTION
  Dono: Henrique (Platform/SRE) - US-0.6 / TASK-0.6.2

  Gera em ./secrets/ (diretorio 100% ignorado pelo Git):
    postgres_superuser_password   senha do superusuario (bootstrap do cluster)
    postgres_app_password         senha da role movivo_app (runtime, sem BYPASSRLS)
    postgres_migrator_password    senha da role movivo_migrator (migracoes)
    redis_password                requirepass do Redis master/replica/sentinel
    pgcrypto_key                  chave de criptografia de dados de saude (Sprint 2)
    pgbouncer_userlist.txt        auth_file do PgBouncer, derivado das senhas acima

  ATENCAO - ESTE ARQUIVO E INTENCIONALMENTE 100% ASCII.
  O Windows PowerShell 5.1 le um .ps1 sem BOM como cp1252; qualquer caractere
  UTF-8 acentuado ou travessao vira aspa curva e quebra o parser. Nao introduza
  acentos, travessoes nem simbolos aqui - use SECURITY.md para texto rico.

  Os arquivos de secret sao gravados em UTF-8 SEM BOM e SEM newline final: um
  BOM entraria dentro do valor da senha e quebraria a autenticacao no
  Postgres/Redis. O userlist.txt usa terminador LF.

  Valores sao DESCARTAVEIS e validos apenas nesta maquina. Nunca reutilize um
  secret local em staging ou producao.

.PARAMETER Force
  Rotaciona (sobrescreve) todos os secrets. Sem este switch o script e
  idempotente e so cria o que estiver faltando. Depois de -Force, recrie os
  volumes do Postgres: a senha de uma role ja criada nao muda sozinha.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/gen-local-secrets.ps1

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/gen-local-secrets.ps1 -Force
#>
[CmdletBinding()]
param(
  [switch]$Force
)

$ErrorActionPreference = 'Stop'

$RepoRoot   = Split-Path -Parent $PSScriptRoot
$SecretsDir = Join-Path $RepoRoot 'secrets'

# Charset alfanumerico de proposito: a senha entra no userlist.txt do PgBouncer
# (delimitado por aspas) e em DSNs; aspas, barras e '@' quebrariam o parsing.
# 40 chars de [A-Za-z0-9] valem ~238 bits de entropia.
function New-RandomToken {
  param([int]$Length = 40)

  $alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  $sb = New-Object System.Text.StringBuilder
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $buffer = New-Object 'byte[]' 256
    $i = $buffer.Length
    while ($sb.Length -lt $Length) {
      if ($i -ge $buffer.Length) {
        $rng.GetBytes($buffer)
        $i = 0
      }
      $b = $buffer[$i]
      $i++
      # Rejeicao do resto do modulo para nao enviesar o charset (62 nao divide 256).
      if ($b -lt 248) {
        [void]$sb.Append($alphabet[$b % 62])
      }
    }
  }
  finally {
    $rng.Dispose()
  }
  return $sb.ToString()
}

# Grava sem BOM e sem newline final (equivalente ao "printf '%s'" do Bash).
function Write-RawFile {
  param([string]$Path, [string]$Content)

  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

function Write-Secret {
  param([string]$Name, [string]$Value)

  $path = Join-Path $SecretsDir $Name
  if ((Test-Path -LiteralPath $path) -and (-not $Force)) {
    Write-Output ("  = {0} (mantido, use -Force para rotacionar)" -f $Name)
    return
  }
  Write-RawFile -Path $path -Content $Value
  Write-Output ("  + {0} ({1} bytes)" -f $Name, $Value.Length)
}

if (-not (Test-Path -LiteralPath $SecretsDir)) {
  New-Item -ItemType Directory -Path $SecretsDir | Out-Null
}

Write-Output ("MOVIVO - gerando Docker Secrets locais em: {0}" -f $SecretsDir)
if ($Force) {
  Write-Output '  (modo -Force: TODOS os secrets serao rotacionados)'
}

Write-Secret -Name 'postgres_superuser_password' -Value (New-RandomToken 40)
Write-Secret -Name 'postgres_app_password'       -Value (New-RandomToken 40)
Write-Secret -Name 'postgres_migrator_password'  -Value (New-RandomToken 40)
Write-Secret -Name 'redis_password'              -Value (New-RandomToken 48)
Write-Secret -Name 'pgcrypto_key'                -Value (New-RandomToken 64)

# userlist.txt do PgBouncer.
# Sempre reescrito a partir dos arquivos de senha vigentes, para nunca ficar
# dessincronizado do Postgres. Senha em claro e aceitavel aqui porque o arquivo
# e um Docker Secret montado somente-leitura, fora da imagem, e o auth_type e
# scram-sha-256: o pooler deriva o SCRAM ao falar com o servidor.
$appUser = if ($env:POSTGRES_APP_USER) { $env:POSTGRES_APP_USER } else { 'movivo_app' }
$migratorUser = if ($env:POSTGRES_MIGRATOR_USER) { $env:POSTGRES_MIGRATOR_USER } else { 'movivo_migrator' }

$appPwd      = [System.IO.File]::ReadAllText((Join-Path $SecretsDir 'postgres_app_password'))
$migratorPwd = [System.IO.File]::ReadAllText((Join-Path $SecretsDir 'postgres_migrator_password'))

$userlist = '"{0}" "{1}"{4}"{2}" "{3}"{4}' -f $appUser, $appPwd, $migratorUser, $migratorPwd, "`n"
Write-RawFile -Path (Join-Path $SecretsDir 'pgbouncer_userlist.txt') -Content $userlist
Write-Output ("  + pgbouncer_userlist.txt ({0}, {1})" -f $appUser, $migratorUser)

# Guarda de seguranca: prova, no proprio script, que nada gerado aqui e visivel
# para o Git.
$git = Get-Command git -ErrorAction SilentlyContinue
if ($git) {
  Push-Location $RepoRoot
  try {
    $tracked = & git ls-files --cached --others --exclude-standard -- secrets/
    $leaked = @($tracked | Where-Object { $_ -and $_ -notmatch '^secrets/(README\.md|\.gitkeep)$' })
    if ($leaked.Count -gt 0) {
      Write-Output 'ERRO CRITICO: arquivo de secret visivel para o Git:'
      $leaked | ForEach-Object { Write-Output ("  {0}" -f $_) }
      exit 1
    }
    Write-Output '  OK verificacao: nenhum secret visivel para o Git'
  }
  finally {
    Pop-Location
  }
}

Write-Output ''
Write-Output 'Pronto. Proximos passos:'
Write-Output '  1. copy .env.example .env                       (raiz, perfil do Docker Compose)'
Write-Output '  2. copy apps\api\.env.example apps\api\.env     (API rodando no host)'
Write-Output '  3. copy apps\web\.env.example apps\web\.env.local'
Write-Output '  4. docker compose -f docker-compose.yml -f docker-compose.secrets.yml up -d   (US-0.2)'
Write-Output ''
Write-Output 'Nunca imprima, cole em chat/issue nem commite o conteudo de secrets/.'
