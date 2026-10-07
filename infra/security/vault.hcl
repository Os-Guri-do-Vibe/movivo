ui = false
# Raft mmap: follow HashiCorp guidance; the container explicitly has zero swap.
disable_mlock = true
api_addr = "https://vault:8200"
cluster_addr = "https://vault:8201"
storage "raft" {
  path = "/vault/data"
  node_id = "movivo-vault"
}
listener "tcp" {
  address = "0.0.0.0:8200"
  cluster_address = "0.0.0.0:8201"
  tls_cert_file = "/tmp/tls/server.crt"
  tls_key_file = "/tmp/tls/server.key"
  tls_min_version = "tls12"
}
