#!/bin/bash
# =============================================================================
#  GWM x Innopower — VPS Setup Script (Ubuntu)
#  รันครั้งเดียวบน VPS ใหม่ ติดตั้งทุกอย่างอัตโนมัติ
#
#  วิธีใช้:
#    chmod +x setup.sh
#    sudo bash setup.sh
# =============================================================================

set -e

WEB_ROOT="/var/www/gwm"
NGINX_CONF="/etc/nginx/sites-available/gwm-dashboard"
HTPASSWD_FILE="/etc/nginx/.htpasswd"
LOG_FILE="/var/log/gwm-pull.log"

echo ""
echo "=== GWM x Innopower — VPS Setup ==="
echo ""

# --- 1) ติดตั้ง dependencies ---
echo "[1/6] Installing nginx and Node.js..."
apt-get update -qq
apt-get install -y nginx apache2-utils curl

# Node.js 20 LTS
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
fi
echo "  OK: nginx $(nginx -v 2>&1 | grep -o '[0-9.]*$'), node $(node -v)"

# --- 2) สร้าง directory structure ---
echo "[2/6] Creating directory structure..."
mkdir -p "$WEB_ROOT/Dashboard/v3"
mkdir -p "$WEB_ROOT/Dashboard/v4-gwm"
mkdir -p "$WEB_ROOT/data/snapshots"
mkdir -p "$WEB_ROOT/scripts"
echo "  OK: $WEB_ROOT"

# --- 3) คัดลอกไฟล์ dashboard ---
echo "[3/6] Copying dashboard files..."
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUNDLE_DIR="$(dirname "$SCRIPT_DIR")"

# Dashboard files (ไม่เอา serve.ps1)
for f in index.html app.js category-engine.js styles.css category-keys.md; do
    [ -f "$BUNDLE_DIR/Dashboard/v3/$f" ]     && cp "$BUNDLE_DIR/Dashboard/v3/$f"     "$WEB_ROOT/Dashboard/v3/"
    [ -f "$BUNDLE_DIR/Dashboard/v4-gwm/$f" ] && cp "$BUNDLE_DIR/Dashboard/v4-gwm/$f" "$WEB_ROOT/Dashboard/v4-gwm/"
done
[ -f "$BUNDLE_DIR/Dashboard/sla-requirements.html" ]       && cp "$BUNDLE_DIR/Dashboard/sla-requirements.html"       "$WEB_ROOT/Dashboard/"
[ -f "$BUNDLE_DIR/Dashboard/case-classification-tree.html" ] && cp "$BUNDLE_DIR/Dashboard/case-classification-tree.html" "$WEB_ROOT/Dashboard/"

# Pull script
cp "$SCRIPT_DIR/scripts/pull-daily.js" "$WEB_ROOT/scripts/"
[ -f "$BUNDLE_DIR/scripts/credentials.example.json" ] && cp "$BUNDLE_DIR/scripts/credentials.example.json" "$WEB_ROOT/scripts/"

# คัดลอก existing snapshots (ถ้ามี)
if [ -d "$BUNDLE_DIR/data/snapshots" ] && [ "$(ls -A "$BUNDLE_DIR/data/snapshots")" ]; then
    cp "$BUNDLE_DIR/data/snapshots/"*.json "$WEB_ROOT/data/snapshots/" 2>/dev/null || true
    echo "  OK: copied existing snapshots"
fi
[ -f "$BUNDLE_DIR/data/index.csv" ] && cp "$BUNDLE_DIR/data/index.csv" "$WEB_ROOT/data/"

chown -R www-data:www-data "$WEB_ROOT"
echo "  OK: files copied"

# --- 4) ตั้ง credentials portal ---
echo "[4/6] Setting up portal credentials..."
CRED_PATH="$WEB_ROOT/scripts/credentials.json"
if [ ! -f "$CRED_PATH" ]; then
    echo "  Enter portal credentials for ev.rpdservice.com (gwm_headoffice account):"
    read -rp "  Username: " PORTAL_USER
    read -rsp "  Password: " PORTAL_PASS
    echo ""
    cat > "$CRED_PATH" <<JSON
{
  "baseUrl": "https://ev.rpdservice.com",
  "username": "$PORTAL_USER",
  "password": "$PORTAL_PASS"
}
JSON
    chmod 600 "$CRED_PATH"
    echo "  OK: credentials.json created"
else
    echo "  SKIP: credentials.json already exists"
fi

# --- 5) ตั้ง dashboard login (basic auth) ---
echo "[5/6] Setting up dashboard login..."
echo "  สร้าง username/password สำหรับเข้า dashboard (แยกจาก portal credentials)"
echo "  แนะนำ: สร้างอย่างน้อย 2 user — ops team 1 ชุด, GWM exec 1 ชุด"
echo ""

ADD_MORE="y"
while [ "$ADD_MORE" = "y" ]; do
    read -rp "  Dashboard username: " DASH_USER
    htpasswd -b "$HTPASSWD_FILE" "$DASH_USER" "$(read -rsp "  Password for $DASH_USER: " p && echo "$p" && echo "")"
    echo "  OK: user '$DASH_USER' added"
    read -rp "  Add another user? (y/n): " ADD_MORE
done

# --- 6) ตั้ง Nginx ---
echo "[6/6] Configuring Nginx..."
cp "$SCRIPT_DIR/nginx/gwm-dashboard.conf" "$NGINX_CONF"
rm -f /etc/nginx/sites-enabled/default
ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/gwm-dashboard
nginx -t
systemctl reload nginx
echo "  OK: nginx configured and reloaded"

# --- ตั้ง cron job ---
echo ""
echo "Setting up daily cron job (23:55 every night)..."
CRON_LINE="55 23 * * * /usr/bin/node $WEB_ROOT/scripts/pull-daily.js >> $LOG_FILE 2>&1"
(crontab -l 2>/dev/null | grep -v "pull-daily.js"; echo "$CRON_LINE") | crontab -
echo "  OK: cron job added"

# --- ทดสอบ pull ครั้งแรก ---
echo ""
read -rp "Pull ข้อมูลจาก portal ตอนนี้เลย? (y/n): " DO_PULL
if [ "$DO_PULL" = "y" ]; then
    echo "Pulling..."
    node "$WEB_ROOT/scripts/pull-daily.js"
fi

# --- Done ---
VPS_IP=$(curl -s ifconfig.me 2>/dev/null || echo "<VPS_IP>")
echo ""
echo "======================================================"
echo "  Setup complete!"
echo ""
echo "  Ops Dashboard:  http://$VPS_IP/Dashboard/v3/"
echo "  Exec Dashboard: http://$VPS_IP/Dashboard/v4-gwm/"
echo ""
echo "  Pull log:       $LOG_FILE"
echo "  Snapshots:      $WEB_ROOT/data/snapshots/"
echo "======================================================"
echo ""
