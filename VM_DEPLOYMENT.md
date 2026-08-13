# CampusServe VM deployment

This deployment targets Ubuntu 24.04 LTS, Node.js 22, Nginx, systemd, Let's Encrypt, and MongoDB Atlas. Nginx is the only public process; Node listens on `127.0.0.1:3001`.

## 1. Before deployment

1. Create an Ubuntu VM with at least 2 vCPU, 2 GB RAM, and 20 GB disk.
2. Point the domain's DNS `A` record to the VM's static public IPv4 address.
3. In MongoDB Atlas, allow only the VM's outbound IP and create a least-privilege database user with read/write and index-management permissions for the CampusServe database. Do not use `0.0.0.0/0`.
4. Install Node.js 22.12 or newer within the Node 22 LTS line and confirm it with `node --version`.
5. Clone/copy this project to `/opt/campusserve/current`.

## 2. Configure and install

From `/opt/campusserve/current`, run:

```bash
sudo bash deploy/configure-ubuntu.sh campusserve.example.edu admin@example.edu
```

The first run creates `/etc/campusserve/campusserve.env` and stops. Edit that file and replace every placeholder. Generate three different secrets with:

```bash
openssl rand -base64 48
```

Run the installer again. It installs/builds the application, enables systemd, configures the firewall, obtains a Let's Encrypt certificate, enables HTTP-to-HTTPS redirection, and runs the health check.

Do not copy the local `.env` to the VM. The systemd service reads only `/etc/campusserve/campusserve.env`, which is restricted to root and the service group.

Leave `DNS_SERVERS` empty to use the VM resolver. Set it to a comma-separated resolver list only if an Atlas `mongodb+srv` lookup fails and those resolvers are approved for your network.

## 3. Install backups

Install MongoDB Database Tools first, then:

```bash
sudo install -m 0750 deploy/mongodb-backup.sh /usr/local/sbin/campusserve-mongodb-backup
sudo install -m 0644 deploy/campusserve-backup.service /etc/systemd/system/
sudo install -m 0644 deploy/campusserve-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now campusserve-backup.timer
sudo systemctl start campusserve-backup.service
sudo journalctl -u campusserve-backup.service --no-pager
```

Backups are encrypted in transit by MongoDB TLS, stored with mode `0700` under `/var/backups/campusserve`, and retained for 14 days. Copy them to encrypted off-VM storage and test restoration before launch.

## 4. Verify production

```bash
npm run verify:deployment -- https://campusserve.example.edu
sudo systemctl status campusserve --no-pager
sudo journalctl -u campusserve -n 100 --no-pager
sudo nginx -t
sudo certbot renew --dry-run
sudo ss -lntp
```

Only ports 22, 80, and 443 should be public. Port 3001 must listen only on `127.0.0.1`.

## 5. Updating

Back up the database, update files in `/opt/campusserve/current`, and run:

```bash
npm ci
npm run test:run
npm run build
npm prune --omit=dev
sudo systemctl restart campusserve
npm run verify:deployment -- https://campusserve.example.edu
```

Keep the previous application directory or VM snapshot until verification passes. Review `npm audit --omit=dev` before each release.

## Operations

- Application logs: `journalctl -u campusserve`
- Nginx logs: `/var/log/nginx/access.log` and `/var/log/nginx/error.log`
- Certificate renewal: the Certbot systemd timer handles renewal automatically.
- Readiness: `GET /api/health` returns HTTP 200 only while MongoDB is connected.
- Collections and indexes are created/validated during startup. A permissions failure prevents the service from starting.
