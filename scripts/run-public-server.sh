#!/bin/zsh
set -euo pipefail

# Run the entry point directly so its main-module check also works under PM2.
exec /opt/homebrew/bin/node "${0:A:h:h}/server.mjs"
