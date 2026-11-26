#!/bin/sh
# Gera o env.json lido pelo config.js. O browser fala com a API através do
# proxy /api/ deste nginx, que acrescenta a chave; por isso o env.json não
# leva a chave verdadeira (o config.js só precisa de um valor não vazio).
set -eu

if [ -z "${API_UPSTREAM:-}" ] || [ -z "${API_KEY:-}" ]; then
    echo "ERRO: defina API_UPSTREAM (ex.: http://host.docker.internal:8001) e API_KEY." >&2
    exit 1
fi

cat > /usr/share/nginx/html/env.json <<'EOF'
{
  "API_URL": "/api",
  "API_KEY": "via-proxy"
}
EOF
