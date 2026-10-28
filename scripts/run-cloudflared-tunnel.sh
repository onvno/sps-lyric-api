#!/bin/zsh
set -euo pipefail

exec /opt/homebrew/bin/cloudflared --protocol http2 tunnel --url http://127.0.0.1:8791 --http-host-header lyrics.lemmon.cn run sps-lyric-api
