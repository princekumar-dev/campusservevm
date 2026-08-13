#!/usr/bin/env bash
set -euo pipefail

ENV_FILE=/etc/campusserve/campusserve.env
BACKUP_DIR=/var/backups/campusserve

if [[ ! -r "$ENV_FILE" ]]; then
  echo "Cannot read $ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

: "${MONGODB_URI:?MONGODB_URI is required}"
install -d -m 0700 "$BACKUP_DIR"
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
mongodump --uri="$MONGODB_URI" --archive="$BACKUP_DIR/campusserve-$timestamp.archive.gz" --gzip
find "$BACKUP_DIR" -type f -name 'campusserve-*.archive.gz' -mtime +14 -delete
