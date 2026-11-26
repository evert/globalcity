#!/usr/bin/env bash
# One-shot setup on a Raspberry Pi 5 (Debian 12/13 arm64) with a Cloudflare Tunnel in front.
# Run ON THE PI as a sudo-capable user after deploy/pi/push.sh has synced the code:
#   bash /opt/globalcity/deploy/pi/setup.sh
# Optional: CF_TUNNEL_TOKEN=<token from Zero Trust > Networks > Tunnels> to install cloudflared as a service too.
set -euo pipefail

APP_DIR=/opt/globalcity
APP_USER=globalcity

echo "==> Packages"
sudo apt-get update -qq
sudo apt-get install -y -qq curl rsync ca-certificates gnupg

if ! command -v node >/dev/null || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 22 ]; then
  echo "==> Node.js 24 (NodeSource)"
  curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
  sudo apt-get install -y -qq nodejs
fi
echo "    node $(node -v)"

if ! command -v cloudflared >/dev/null; then
  echo "==> cloudflared (Cloudflare apt repo)"
  sudo mkdir -p --mode=0755 /usr/share/keyrings
  curl -fsSL https://pkg.cloudflare.com/cloudflare-public-v2.gpg | sudo tee /usr/share/keyrings/cloudflare-public-v2.gpg >/dev/null
  # Cloudflare publishes one pool for all Debian/Ubuntu releases under "any main".
  echo 'deb [signed-by=/usr/share/keyrings/cloudflare-public-v2.gpg] https://pkg.cloudflare.com/cloudflared any main' | sudo tee /etc/apt/sources.list.d/cloudflared.list >/dev/null
  sudo apt-get update -qq && sudo apt-get install -y -qq cloudflared
fi
echo "    $(cloudflared --version)"

echo "==> App user and directory"
id -u $APP_USER >/dev/null 2>&1 || sudo useradd --system --create-home --shell /usr/sbin/nologin $APP_USER
[ -f $APP_DIR/package.json ] || { echo "!! $APP_DIR has no code. Run deploy/pi/push.sh from your dev machine first."; exit 1; }
sudo chown -R $APP_USER:$APP_USER $APP_DIR

echo "==> Install, generate world, build client"
cd $APP_DIR
sudo -u $APP_USER npm ci --no-audit --no-fund 2>/dev/null || sudo -u $APP_USER npm install --no-audit --no-fund
WORLD_DIR=data/world-$(node -e "import('./shared/src/constants.ts').then(m => console.log(m.WORLD_TAG))" 2>/dev/null || echo 16384x8192)
[ -f $WORLD_DIR/base.bin ] || { sudo -u $APP_USER bash tools/fetch-terrain-data.sh && sudo -u $APP_USER npm run gen:world; }
[ -f $WORLD_DIR/places.json ] || sudo -u $APP_USER npm run gen:places -w tools
sudo -u $APP_USER npm run build

echo "==> systemd service"
sudo cp deploy/pi/globalcity.service /etc/systemd/system/globalcity.service
sudo systemctl daemon-reload
sudo systemctl enable --now globalcity
sleep 3
curl -s http://127.0.0.1:8787/health; echo

echo "==> Daily backup of data/save to /var/backups/globalcity (keeps 14)"
sudo install -m 755 deploy/pi/backup.sh /usr/local/bin/globalcity-backup
# A cron.d file (not root's crontab): idempotent, and no pipeline that can fail under `set -e`.
echo "17 3 * * * root /usr/local/bin/globalcity-backup" | sudo tee /etc/cron.d/globalcity-backup >/dev/null

if [ -n "${CF_TUNNEL_TOKEN:-}" ]; then
  echo "==> cloudflared as a service (dashboard-managed tunnel)"
  sudo cloudflared service install "$CF_TUNNEL_TOKEN"
  sudo systemctl enable --now cloudflared
  systemctl --no-pager --lines=3 status cloudflared | sed -n 1,8p
else
  cat <<'MSG'

Next: connect the tunnel (one-off, needs your Cloudflare account):
  1. Zero Trust dashboard > Networks > Tunnels > Create a tunnel > Cloudflared, name it "globalcity".
  2. Copy the token from the install command it shows, then on the Pi:
       sudo cloudflared service install <TOKEN>
  3. In the tunnel's "Public Hostname" tab add e.g. city.<your-domain>  ->  Service: HTTP, URL: localhost:8787
  WebSockets are passed through by default. Done: https://city.<your-domain>
MSG
fi
