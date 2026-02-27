#!/usr/bin/env bash
set -euo pipefail

SOURCE_CERT_DIR="${SOURCE_CERT_DIR:-/etc/ssl/virtualmin/1691420266222853}"
TARGET_CERT_DIR="${TARGET_CERT_DIR:-/home/otaupdates/ssl}"
TARGET_OWNER="${TARGET_OWNER:-otaupdates:otaupdates}"
SUPERVISOR_PROGRAM="${SUPERVISOR_PROGRAM:-updates-server}"

CERT_FILE="${SOURCE_CERT_DIR}/ssl.cert"
KEY_FILE="${SOURCE_CERT_DIR}/ssl.key"
CA_FILE="${SOURCE_CERT_DIR}/ssl.ca"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

require_file() {
  local file="$1"
  if [[ ! -f "$file" ]]; then
    log "ERROR: Missing file: $file"
    exit 1
  fi
}

log "Starting certificate post-renew hook"

require_file "$CERT_FILE"
require_file "$KEY_FILE"
require_file "$CA_FILE"

mkdir -p "$TARGET_CERT_DIR"
cp -f "$CERT_FILE" "$TARGET_CERT_DIR/ssl.cert"
cp -f "$KEY_FILE" "$TARGET_CERT_DIR/ssl.key"
cp -f "$CA_FILE" "$TARGET_CERT_DIR/ssl.ca"

chown "$TARGET_OWNER" "$TARGET_CERT_DIR/ssl.cert" "$TARGET_CERT_DIR/ssl.key" "$TARGET_CERT_DIR/ssl.ca"
chmod 600 "$TARGET_CERT_DIR/ssl.key"
chmod 644 "$TARGET_CERT_DIR/ssl.cert" "$TARGET_CERT_DIR/ssl.ca"

if command -v supervisorctl >/dev/null 2>&1; then
  log "Restarting Supervisor program: $SUPERVISOR_PROGRAM"
  supervisorctl restart "$SUPERVISOR_PROGRAM"
  log "Supervisor restart completed"
else
  log "ERROR: supervisorctl not found in PATH"
  exit 1
fi

log "Certificate post-renew hook completed"
