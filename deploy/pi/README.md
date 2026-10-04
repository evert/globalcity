# GlobalCity on a Raspberry Pi 5 behind a Cloudflare Tunnel

The game server runs as a systemd service bound to 127.0.0.1:8787. `cloudflared` opens an
outbound tunnel to Cloudflare, which terminates TLS and proxies HTTPS and WebSockets to it.
No router port forwarding, no public IP, no certificates to manage. Geolocation works because
the site is served over https.

## One-off setup

```sh
# from your dev machine, in the repo root
deploy/pi/push.sh node05                 # rsync the code to /opt/globalcity on the Pi
ssh node05 bash /opt/globalcity/deploy/pi/setup.sh
```

`setup.sh` installs cloudflared from Cloudflare's apt repo, creates a `globalcity` system user,
installs dependencies, generates the world and place names, builds the client, installs and starts
the service, and adds a nightly backup of `data/save` to `/var/backups/globalcity`.

## Connect the tunnel (needs your Cloudflare account)

1. Cloudflare dashboard > Zero Trust > Networks > Tunnels > **Create a tunnel** > Cloudflared.
   Name it `globalcity`.
2. It shows an install command containing a long token. On the Pi run:
   ```sh
   sudo cloudflared service install <TOKEN>
   ```
   (or re-run `CF_TUNNEL_TOKEN=<TOKEN> bash /opt/globalcity/deploy/pi/setup.sh`).
3. In the tunnel's **Public Hostname** tab: subdomain `city`, your domain, type `HTTP`,
   URL `localhost:8787`. Save.
4. Open `https://city.<your-domain>`.

WebSockets are proxied by tunnels out of the box. Cloudflare closes idle WebSockets after
100 seconds; the client pings every 20 seconds, so that never triggers.

## Day to day

```sh
ssh node05 sudo systemctl status globalcity       # running?
ssh node05 sudo journalctl -u globalcity -f       # logs
ssh node05 curl -s http://127.0.0.1:8787/health   # {"online":..,"players":..,"claims":..,"tick":..}
deploy/pi/push.sh node05                          # redeploy client/static: rsync + npm install + build, no restart
deploy/pi/push.sh node05 --restart                # ...and restart the server (drops players for ~3 s; saves first)
ssh node05 sudo systemctl status cloudflared      # tunnel health
```

Reset the world: `ssh node05 'sudo systemctl stop globalcity && sudo rm -rf /opt/globalcity/data/save && sudo systemctl start globalcity'`.

## Notes

- Memory use is around 200 MB; the Pi 5 has plenty. CPU is idle except for a brief tick every 2 s.
- The server saves dirty chunks every 10 s and on SIGTERM, so `systemctl restart` is safe.
- Something else on the Pi already listens on port 80. That is fine; the game never binds 80 or 443.
