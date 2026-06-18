#!/bin/bash
set -e

echo "=== Step 1: 写测试文件 ==="
echo "test-token-ok" > /var/www/certbot/.well-known/acme-challenge/test-token
ls -la /var/www/certbot/.well-known/acme-challenge/test-token

echo ""
echo "=== Step 2: 本地 curl http（应返回 200 + test-token-ok，不是 301）==="
curl -s -o /tmp/curl_body.txt -w "%{http_code}" http://localhost/.well-known/acme-challenge/test-token
echo ""
cat /tmp/curl_body.txt

echo ""
echo "=== Step 3: 域名 curl http ==="
curl -s -o /tmp/curl_body2.txt -w "%{http_code}" http://papacheck.chengdexy.cn/.well-known/acme-challenge/test-token
echo ""
cat /tmp/curl_body2.txt

# 清理
rm -f /var/www/certbot/.well-known/acme-challenge/test-token

echo ""
echo "=== Step 4: certbot dry-run ==="
certbot renew --dry-run 2>&1 | tail -15
