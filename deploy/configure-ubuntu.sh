#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: sudo bash deploy/configure-ubuntu.sh <domain> <letsencrypt-email>" >&2
  exit 2
fi

DOMAIN=$1
LE_EMAIL=$2
APP_DIR=/opt/campusserve/current
ENV_DIR=/etc/campusserve

if [[ $EUID -ne 0 ]]; then
  echo "Run this script with sudo." >&2
  exit 1
fi
if [[ ! -f package.json || ! -f deploy/campusserve.service ]]; then
  echo "Run this script from the CampusServe project directory." >&2
  exit 1
fi
if [[ ! "$DOMAIN" =~ ^[A-Za-z0-9.-]+$ ]]; then
  echo "Invalid domain name." >&2
  exit 1
fi

apt-get update
apt-get install -y nginx certbot python3-certbot-nginx ufw curl

if ! id campusserve >/dev/null 2>&1; then
  useradd --system --home-dir /opt/campusserve --shell /usr/sbin/nologin campusserve
fi

install -d -o campusserve -g campusserve -m 0750 /opt/campusserve
install -d -o root -g campusserve -m 0750 "$ENV_DIR"

if [[ ! -f "$ENV_DIR/campusserve.env" ]]; then
  sed "s/campusserve\.example\.edu/$DOMAIN/g; s/admin@example\.edu/$LE_EMAIL/g" deploy/campusserve.env.example > "$ENV_DIR/campusserve.env"
  chown root:campusserve "$ENV_DIR/campusserve.env"
  chmod 0640 "$ENV_DIR/campusserve.env"
  echo "Created $ENV_DIR/campusserve.env. Replace every placeholder, then rerun this script."
  exit 3
fi

if grep -Eq 'GENERATE_|USERNAME:PASSWORD|example\.edu' "$ENV_DIR/campusserve.env"; then
  echo "$ENV_DIR/campusserve.env still contains placeholders." >&2
  exit 3
fi

project_path=$(pwd -P)
if [[ "$project_path" != "$APP_DIR" ]]; then
  echo "Move or clone the project to $APP_DIR before continuing." >&2
  exit 3
fi

chown -R campusserve:campusserve /opt/campusserve
sudo -u campusserve npm ci
sudo -u campusserve npm run build
sudo -u campusserve npm prune --omit=dev

install -m 0644 deploy/campusserve.service /etc/systemd/system/campusserve.service
sed "s/campusserve\.example\.edu/$DOMAIN/g" deploy/campusserve.nginx.conf > /etc/nginx/sites-available/campusserve
ln -sfn /etc/nginx/sites-available/campusserve /etc/nginx/sites-enabled/campusserve
rm -f /etc/nginx/sites-enabled/default

nginx -t
systemctl daemon-reload
systemctl enable --now campusserve
systemctl reload nginx

ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

certbot --nginx --non-interactive --agree-tos --redirect -m "$LE_EMAIL" -d "$DOMAIN"
systemctl reload nginx
curl --fail --silent --show-error "https://$DOMAIN/api/health"
echo
echo "CampusServe is running at https://$DOMAIN"
