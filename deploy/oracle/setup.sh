#!/usr/bin/env bash
# One-shot setup for an Oracle Cloud Always Free VM (Ubuntu 22.04/24.04, ARM or x86).
# Run as a sudo-capable user ON THE VM:
#   DOMAIN=city.example.com bash setup.sh            # with a domain (TLS via Let's Encrypt)
#   DOMAIN=":80" bash setup.sh                       # no domain yet, plain http on the public IP
# Optional: REPO_URL=https://github.com/you/globalcity.git to clone instead of rsync-ing.
set -euo pipefail

DOMAIN="${DOMAIN:-:80}"
APP_DIR=/opt/globalcity
APP_USER=globalcity

echo "==> Packages"
sudo apt-get update -qq
sudo apt-get install -y -qq curl git rsync debian-keyring debian-archive-keyring apt-transport-https ca-certificates

if ! command -v node >/dev/null || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 22 ]; then
  echo "==> Node.js 24 (NodeSource)"
  curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
  sudo apt-get install -y -qq nodejs
fi
node -v

if ! command -v caddy >/dev/null; then
  echo "==> Caddy"
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  sudo apt-get update -qq && sudo apt-get install -y -qq caddy
fi

echo "==> Firewall: Oracle's Ubuntu images ship iptables rules that drop 80/443. Opening them."
sudo iptables -C INPUT -p tcp --dport 80 -j ACCEPT 2>/dev/null || sudo iptables -I INPUT 6 -p tcp --dport 80 -j ACCEPT
sudo iptables -C INPUT -p tcp --dport 443 -j ACCEPT 2>/dev/null || sudo iptables -I INPUT 6 -p tcp --dport 443 -j ACCEPT
sudo apt-get install -y -qq netfilter-persistent iptables-persistent >/dev/null 2>&1 || true
sudo netfilter-persistent save >/dev/null 2>&1 || true
echo "    (You must ALSO open 80 and 443 in the VCN security list in the Oracle console.)"

echo "==> App user and directory"
id -u $APP_USER >/dev/null 2>&1 || sudo useradd --system --create-home --shell /usr/sbin/nologin $APP_USER
sudo mkdir -p $APP_DIR
if [ -n "${REPO_URL:-}" ]; then
  if [ -d $APP_DIR/.git ]; then sudo -u $APP_USER git -C $APP_DIR pull --ff-only; else sudo git clone "$REPO_URL" $APP_DIR; fi
fi
sudo chown -R $APP_USER:$APP_USER $APP_DIR

if [ ! -f $APP_DIR/package.json ]; then
  echo "!! $APP_DIR has no code yet. Either set REPO_URL, or from your dev machine run: deploy/oracle/push.sh user@this-host"
  echo "   Then re-run this script."
  exit 1
fi

echo "==> Install, generate world, build client"
cd $APP_DIR
sudo -u $APP_USER npm ci --no-audit --no-fund 2>/dev/null || sudo -u $APP_USER npm install --no-audit --no-fund
[ -f data/world/base.bin ] || sudo -u $APP_USER npm run gen:world
sudo -u $APP_USER npm run build

echo "==> systemd + Caddy"
sudo cp deploy/oracle/globalcity.service /etc/systemd/system/globalcity.service
sudo install -m 644 deploy/oracle/Caddyfile /etc/caddy/Caddyfile
echo "DOMAIN=$DOMAIN" | sudo tee /etc/caddy/env >/dev/null
sudo mkdir -p /etc/systemd/system/caddy.service.d
printf '[Service]\nEnvironmentFile=/etc/caddy/env\n' | sudo tee /etc/systemd/system/caddy.service.d/env.conf >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable --now globalcity
sudo systemctl restart caddy

echo "==> Daily backup of data/save to /var/backups/globalcity (keeps 14)"
sudo install -m 755 deploy/oracle/backup.sh /usr/local/bin/globalcity-backup
# A cron.d file (not root's crontab): idempotent, and no pipeline that can fail under `set -e`.
echo "17 3 * * * root /usr/local/bin/globalcity-backup" | sudo tee /etc/cron.d/globalcity-backup >/dev/null

sleep 3
echo "==> Status"
systemctl --no-pager --lines=5 status globalcity | sed -n 1,12p
curl -s http://127.0.0.1:8787/health; echo
PUBIP=$(curl -s -m 3 ifconfig.me || hostname -I | awk '{print $1}')
if [ "$DOMAIN" = ":80" ]; then echo "Open: http://$PUBIP/"; else echo "Open: https://$DOMAIN/"; fi
