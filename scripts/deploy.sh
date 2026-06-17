#!/bin/bash
set -e

SERVER="root@123.57.129.243"
REMOTE_DIR="/opt/papacheck"
APP_DIR="PapaCheck.Server.Node"

echo "=== 1. 本地编译 ==="
cd "$(dirname "$0")/../$APP_DIR"
npx tsc

echo "=== 2. 打包 ==="
cd ..
tar czf /tmp/papacheck.tar.gz \
  "$APP_DIR/dist" \
  "$APP_DIR/package.json" \
  "$APP_DIR/package-lock.json" \
  "$APP_DIR/node_modules/better-sqlite3" \
  "PapaCheck.Web"

echo "=== 3. 上传服务器 ==="
scp /tmp/papacheck.tar.gz "$SERVER:/tmp/"

echo "=== 4. 服务器部署 ==="
ssh "$SERVER" "
  set -e
  mkdir -p $REMOTE_DIR
  tar xzf /tmp/papacheck.tar.gz -C $REMOTE_DIR
  cd $REMOTE_DIR/$APP_DIR
  npm ci --omit=dev --ignore-scripts
  sudo systemctl restart papacheck
  echo '✅ 部署完成'
"

echo "=== 5. 创建备份目录 ==="
ssh "$SERVER" "sudo mkdir -p /var/backups/papacheck && sudo chown -R papacheck:papacheck /var/backups/papacheck && sudo chmod 700 /var/backups/papacheck"

echo "=== 6. 清理 ==="
rm /tmp/papacheck.tar.gz
