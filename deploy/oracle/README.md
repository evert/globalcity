# Deploying GlobalCity on Oracle Cloud Always Free

The server is one long-lived Node process with the world in memory and saves on disk,
so it wants a real VM. Oracle's Always Free tier gives you one (currently 2 Ampere ARM
cores and 12 GB RAM; this app needs well under 1 GB).

## 1. Create the VM (Oracle console, once)

1. Sign up at cloud.oracle.com (a card is required for identity, it is not charged on Always Free shapes).
2. Compute > Instances > Create instance.
   - Image: **Ubuntu 24.04** (Canonical), shape **VM.Standard.A1.Flex**, 1-2 OCPU, 6 GB RAM is plenty.
     If the console says "Out of capacity", try another availability domain or retry later; this is common.
   - Networking: create or pick a VCN with a public subnet, **assign a public IPv4**.
   - Add your SSH public key.
3. Open the ports in the VCN: Networking > Virtual Cloud Networks > your VCN > Security Lists >
   Default > **Add Ingress Rules**: source `0.0.0.0/0`, TCP, destination port `80`, and another for `443`.
   (The VM-level iptables rules are opened by the setup script.)
4. Optional but recommended: point a DNS A record (e.g. `city.example.com`) at the public IP.
   Without a domain the site runs on plain http and browsers will not grant geolocation
   on insecure origins except localhost, so the "Use my location" button will not work. With a
   domain, Caddy gets a Let's Encrypt certificate automatically and everything is https/wss.

## 2. Ship the code

Either push this repo to GitHub and let the VM clone it, or rsync straight from your machine:

```sh
# from your dev machine, in the repo root
deploy/oracle/push.sh ubuntu@<public-ip>
```

## 3. Run the setup script on the VM

```sh
ssh ubuntu@<public-ip>
DOMAIN=city.example.com bash /opt/globalcity/deploy/oracle/setup.sh   # with DNS
DOMAIN=":80"            bash /opt/globalcity/deploy/oracle/setup.sh   # no domain yet
# or, if you prefer cloning:  REPO_URL=https://github.com/you/globalcity.git DOMAIN=... bash setup.sh
```

The script installs Node 24 and Caddy, opens the firewall, creates a `globalcity` system user,
installs dependencies, generates the world (one-off, downloads ~40 MB of Natural Earth data),
builds the client, installs the systemd unit, starts everything, and schedules a nightly
backup of `data/save` to `/var/backups/globalcity`.

## Day to day

```sh
sudo systemctl status globalcity          # running?
sudo journalctl -u globalcity -f          # live logs
curl http://127.0.0.1:8787/health         # {"online":..,"players":..,"claims":..,"tick":..}
sudo systemctl restart globalcity         # SIGTERM flushes saves first
deploy/oracle/push.sh ubuntu@<ip>         # redeploy after local changes (rebuilds + restarts)
```

To reset the world: `sudo systemctl stop globalcity && sudo rm -rf /opt/globalcity/data/save && sudo systemctl start globalcity`.

## Notes

- Caddy proxies WebSockets transparently; the client derives ws/wss from the page protocol.
- The service binds to 127.0.0.1:8787 only; Caddy is the only public listener.
- Memory: roughly 150-250 MB resident. CPU is idle except for a brief tick every 2 s.
