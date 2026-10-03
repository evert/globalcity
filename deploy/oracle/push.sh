#!/usr/bin/env bash
# Sync the working tree from your dev machine to the VM without needing a git remote,
# then restart the service. Usage: deploy/oracle/push.sh ubuntu@1.2.3.4
set -euo pipefail
TARGET="${1:?usage: push.sh user@host}"
HERE="$(cd "$(dirname "$0")/../.." && pwd)"
ssh "$TARGET" 'sudo mkdir -p /opt/globalcity && sudo chown -R $USER /opt/globalcity'
rsync -az --delete \
  --exclude node_modules --exclude dist --exclude data --exclude .git \
  "$HERE/" "$TARGET:/opt/globalcity/"
ssh "$TARGET" 'sudo chown -R globalcity:globalcity /opt/globalcity 2>/dev/null || true
  if systemctl is-enabled globalcity >/dev/null 2>&1; then
    cd /opt/globalcity && sudo -u globalcity npm install --no-audit --no-fund && sudo -u globalcity npm run build && sudo systemctl restart globalcity && sleep 2 && curl -s http://127.0.0.1:8787/health; echo
  else
    echo "Code synced. Now run on the VM:  DOMAIN=... bash /opt/globalcity/deploy/oracle/setup.sh"
  fi'
