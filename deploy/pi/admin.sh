#!/usr/bin/env bash
# GlobalCity admin from your dev machine (runs the request on the Pi itself; the admin API only
# answers on loopback, never through the Cloudflare tunnel, and needs the token in data/save/admin-token).
#
#   deploy/pi/admin.sh announce "Server restart in 5 minutes" [minutes=60] [info|warn]
#   deploy/pi/admin.sh clear
#   deploy/pi/admin.sh status
#   deploy/pi/admin.sh grant <mayor name | player id prefix> <amount>   # cash for one city, live
#
# Announcements show as a banner to everyone online and to anyone connecting before they expire
# (players can dismiss them). Clients from before banners existed get the text as a toast.
# HOST=user@host overrides the target (default node05); PORT the server port (default 8787).
set -euo pipefail
HOST="${HOST:-node05}"; PORT="${PORT:-8787}"
TOKEN_FILE=/opt/globalcity/data/save/admin-token
cmd="${1:-status}"
call() { # $1 method, $2 path; JSON body (if any) on stdin
  ssh "$HOST" "TOKEN=\$(sudo cat $TOKEN_FILE) && curl -s -X $1 -H \"x-admin-token: \$TOKEN\" -H 'content-type: application/json' --data-binary @- http://127.0.0.1:$PORT$2"
  echo
}
case "$cmd" in
  announce)
    msg="${2:?usage: admin.sh announce \"message\" [minutes] [info|warn]}"; minutes="${3:-60}"; level="${4:-info}"
    python3 -c 'import json,sys; print(json.dumps({"msg": sys.argv[1], "minutes": float(sys.argv[2]), "level": sys.argv[3]}))' "$msg" "$minutes" "$level" | call POST /admin/announce ;;
  clear)  echo '{}' | call POST /admin/clear ;;
  status) echo '' | call GET /admin/status ;;
  grant)
    who="${2:?usage: admin.sh grant <mayor name | player id prefix> <amount>}"; amount="${3:?usage: admin.sh grant <mayor name | player id prefix> <amount>}"
    # an id prefix is 6+ hex digits; anything else is taken as the exact mayor name (case-insensitive)
    python3 -c 'import json,re,sys; w,a=sys.argv[1],int(sys.argv[2]); key="id" if re.fullmatch(r"[0-9a-f]{6,}", w) else "name"; print(json.dumps({key: w, "amount": a}))' "$who" "$amount" | call POST /admin/grant ;;
  *) echo "unknown command: $cmd (announce | clear | status | grant)"; exit 1 ;;
esac
