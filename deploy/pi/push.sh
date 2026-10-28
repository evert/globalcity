#!/usr/bin/env bash
# Sync the working tree to the Pi (no git remote needed) and rebuild. The running server is NOT
# restarted unless --restart is given: a restart drops every connected player for a few seconds.
# Usage: deploy/pi/push.sh [user@host] [--restart]   (default host: node05)
set -euo pipefail
TARGET=node05; RESTART=0
for a in "$@"; do case "$a" in --restart) RESTART=1 ;; *) TARGET="$a" ;; esac; done
HERE="$(cd "$(dirname "$0")/../.." && pwd)"
# Hand the code (not data/: the running server saves there every 10 s) to the ssh user for the rsync.
ssh "$TARGET" 'sudo mkdir -p /opt/globalcity && sudo chown "$USER" /opt/globalcity && for d in /opt/globalcity/* /opt/globalcity/.[!.]*; do [ -e "$d" ] && [ "$(basename "$d")" != data ] && sudo chown -R "$USER" "$d"; done; true'
rsync -az --delete \
  --exclude node_modules --exclude dist --exclude data --exclude .git \
  "$HERE/" "$TARGET:/opt/globalcity/"
ssh "$TARGET" "set -e
  if id -u globalcity >/dev/null 2>&1; then sudo chown -R globalcity:globalcity /opt/globalcity; fi
  if systemctl is-enabled globalcity >/dev/null 2>&1; then
    cd /opt/globalcity
    sudo -u globalcity npm install --no-audit --no-fund
    sudo -u globalcity npm run build
    if [ $RESTART = 1 ]; then
      sudo systemctl restart globalcity; sleep 3; echo 'restarted:'; curl -s http://127.0.0.1:8787/health; echo
    else
      echo 'Synced and built. Server NOT restarted (client changes are live on next page load; server'
      echo 'changes need: deploy/pi/push.sh node05 --restart).'
      curl -s http://127.0.0.1:8787/health; echo
    fi
  else
    echo 'Code synced. Now run on the Pi:  bash /opt/globalcity/deploy/pi/setup.sh'
  fi"
