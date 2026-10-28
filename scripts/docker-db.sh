#!/bin/sh
# Host-side helper: Docker Compose is the only runtime requirement.
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
usage() {
  cat <<'HELP'
Usage:
  sh scripts/docker-db.sh --version VERSION [--apply]
  sh scripts/docker-db.sh --backup BACKUP_FILENAME.db [--apply]

Without --apply: validate only, leave the API running and database unchanged.
With --apply: validate, stop the API, back up and replace the database, then
start the API and wait for health. Replacement does not merge local edits.
Release files must be in dist/releases/VERSION (or LYRICS_RELEASE_DIR/VERSION).
Backup filenames refer to the runtime database directory's backups/ folder.
HELP
}
version=''
backup=''
apply=false
while [ "$#" -gt 0 ]; do
  case "$1" in
    --version|--backup)
      key=$1
      [ "$#" -ge 2 ] || { usage >&2; exit 2; }
      case "$2" in ''|*[!A-Za-z0-9._-]*|.*|-*) echo "Invalid $key value" >&2; exit 2;; esac
      if [ "$key" = --version ]; then version=$2; else backup=$2; fi
      shift 2;;
    --apply) apply=true; shift;;
    --help|-h) usage; exit 0;;
    *) usage >&2; exit 2;;
  esac
done
if { [ -z "$version" ] && [ -z "$backup" ]; } || { [ -n "$version" ] && [ -n "$backup" ]; }; then
  usage >&2; exit 2
fi
if [ -n "$version" ]; then
  asset="/releases/$version/sps-lyric-api-$version.db"
  set -- --asset "$asset" --checksum "$asset.sha256"
else
  case "$backup" in *.db) ;; *) echo 'Backup filename must end with .db' >&2; exit 2;; esac
  set -- --asset "/var/lib/sps-lyrics/backups/$backup"
fi
# Prevent overlapping updates started through this helper.
lock=.docker-db-update.lock
mkdir "$lock" 2>/dev/null || { echo 'Another database operation is active. If it was interrupted, remove .docker-db-update.lock after checking.' >&2; exit 1; }
trap 'rmdir "$lock"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
install_database() {
  docker compose run --rm --no-deps -T api node scripts/install-database-release.mjs --db /var/lib/sps-lyrics/lyrics.db "$@"
}
# Checksum and integrity failures must happen before stopping the service.
install_database "$@"
if [ "$apply" = false ]; then
  echo 'Preflight passed. Add --apply to replace the runtime database (local edits are not merged).'
  exit 0
fi
was_running=$(docker compose ps --status running --quiet api)
docker compose stop api
if install_database "$@" --apply; then
  if docker compose up -d --wait --wait-timeout 60 api; then
    echo 'Database installed; API is healthy. The installer output above lists the rollback backup.'
  else
    echo 'API health check failed. Inspect docker compose logs api and restore the backup with --backup FILENAME --apply.' >&2
    exit 1
  fi
else
  echo 'Installation failed. Review the error above; no successful update is reported.' >&2
  if [ -n "$was_running" ]; then docker compose start api; fi
  exit 1
fi
