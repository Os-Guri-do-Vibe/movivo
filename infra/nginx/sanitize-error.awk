# Apenas metadados validados e categorias fixas saem do processo. Texto bruto,
# URI, headers, cliente e caminhos nunca são escritos no stdout/stderr persistido.
{
    line = $0
    severity = "error"
    if (match(line, /\[(debug|info|notice|warn|error|crit|alert|emerg)\]/)) {
        severity = substr(line, RSTART + 1, RLENGTH - 2)
    }
    timestamp = "null"
    if ($1 ~ /^[0-9][0-9][0-9][0-9]\/[0-9][0-9]\/[0-9][0-9]$/ && $2 ~ /^[0-9][0-9]:[0-9][0-9]:[0-9][0-9]$/) {
        date = $1
        gsub(/\//, "-", date)
        timestamp = "\"" date "T" $2 "\""
    }
    category = "nginx_error"
    if (line ~ /upstream timed out/) category = "upstream_timeout"
    else if (line ~ /connect\(\) failed/) category = "upstream_connection_failed"
    else if (line ~ /SSL_do_handshake\(\) failed|SSL handshaking/) category = "tls_handshake_failed"
    else if (line ~ /upstream prematurely closed/) category = "upstream_connection_closed"
    else if (line ~ /upstream sent invalid|upstream sent too big header/) category = "upstream_response_invalid"
    else if (line ~ /too large body/) category = "request_body_too_large"
    else if (line ~ /limiting requests/) category = "rate_limit_exceeded"
    else if (line ~ /worker process .* exited/) category = "worker_exit"
    else if (line ~ /invalid .* directive|unknown directive|configuration file/) category = "nginx_configuration"
    else if (line ~ /open\(\) .* failed|permission denied/) category = "filesystem_error"
    errno = 0
    if (match(line, /\([0-9]+: /)) errno = substr(line, RSTART + 1, RLENGTH - 3) + 0
    connection = 0
    if (match(line, /\*[0-9]+/)) connection = substr(line, RSTART + 1, RLENGTH - 1) + 0
    printf "{\"service\":\"nginx\",\"kind\":\"error\",\"timestamp\":%s,\"severity\":\"%s\",\"event\":\"%s\",\"errno\":%d,\"connection\":%d}\n", timestamp, severity, category, errno, connection
    fflush()
}
