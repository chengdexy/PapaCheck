#!/bin/bash
set -e
echo "=== 1. 检查 renewal config ==="
grep -E "^(authenticator|webroot_path)" /etc/letsencrypt/renewal/papacheck.chengdexy.cn.conf

echo ""
echo "=== 2. 验证 .well-known 路径可访问 ==="
echo "test-token-$(date +%s)" > /var/www/certbot/.well-known/acme-challenge/test-token
curl -sI "http://papacheck.chengdexy.cn/.well-known/acme-challenge/test-token" | head -3
rm -f /var/www/certbot/.well-known/acme-challenge/test-token

echo ""
echo "=== 3. certbot renew --dry-run（webroot 模式）==="
certbot renew --dry-run --webroot -w /var/www/certbot 2>&1 | tail -15
