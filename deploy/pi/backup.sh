#!/usr/bin/env bash
# Tars data/save (edited chunks + players/claims) and keeps the last 14 archives.
set -euo pipefail
SRC=/opt/globalcity/data/save
DST=/var/backups/globalcity
mkdir -p "$DST"
[ -d "$SRC" ] || exit 0
tar -czf "$DST/save-$(date +%Y%m%d-%H%M%S).tar.gz" -C "$(dirname "$SRC")" "$(basename "$SRC")"
ls -1t "$DST"/save-*.tar.gz | tail -n +15 | xargs -r rm -f
