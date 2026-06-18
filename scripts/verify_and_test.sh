#!/bin/bash
set -e

# 清理旧锁
rm -f /var/lib/letsencrypt/.certbot.lock

echo "=== 1. 写 test token ==="
echo "acme-test-$(date +%s)" > /var/www/certbot/.well-known/acme-challenge/test-token

echo "=== 2. curl localhost（期望 200，不是 301）==="
STATUS=$(curl -s -o /tmp/resp.txt -w "%{http_code}" http://localhost/.well-known/acme-challenge/test-token)
echo "HTTP $STATUS"
cat /tmp/resp.txt

echo ""
echo "=== 3. curl 域名 ==="
STATUS2=$(curl -s -o /tmp/resp2.txt -w "%{http_code}" http://papacheck.chengdexy.cn/.well-known/acme-challenge/test-token)
echo "HTTP $STATUS2"
cat /tmp/resp2.txt

rm -f /var/www/certbot/.well-known/acme-challenge/test-token

echo ""
echo "=== 4. certbot renew --dry-run ==="
certbot renew --dry-run 2>&1 | tail -20
