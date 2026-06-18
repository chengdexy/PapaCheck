#!/bin/bash
set -e

echo "=== 1. 修复 certbot renewal config ==="
cat > /etc/letsencrypt/renewal/papacheck.chengdexy.cn.conf << 'CEOF'
# renew_before_expiry = 30 days
version = 2.9.0
archive_dir = /etc/letsencrypt/archive/papacheck.chengdexy.cn
cert = /etc/letsencrypt/live/papacheck.chengdexy.cn/cert.pem
privkey = /etc/letsencrypt/live/papacheck.chengdexy.cn/privkey.pem
chain = /etc/letsencrypt/live/papacheck.chengdexy.cn/chain.pem
fullchain = /etc/letsencrypt/live/papacheck.chengdexy.cn/fullchain.pem

# Options used in the renewal process
[renewalparams]
account = 0e5bd1b1d3537f6b1db78cae6e04fa02
authenticator = webroot
webroot_path = /var/www/certbot
server = https://acme-v02.api.letsencrypt.org/directory
key_type = ecdsa
CEOF
grep -E "^(authenticator|webroot_path)" /etc/letsencrypt/renewal/papacheck.chengdexy.cn.conf
echo "config OK"

echo ""
echo "=== 2. 清除残留锁 ==="
rm -f /var/lib/letsencrypt/.certbot.lock
echo "lock cleared"

echo ""
echo "=== 3. 写 ACME test token ==="
echo "test-token-ok-$(date +%s)" > /var/www/certbot/.well-known/acme-challenge/test-token
ls -la /var/www/certbot/.well-known/acme-challenge/test-token

echo ""
echo "=== 4. curl localhost（应返回 200 + test-token-ok-*，不是 301）==="
STATUS=$(curl -s -o /tmp/curl_body.txt -w "%{http_code}" http://localhost/.well-known/acme-challenge/test-token)
echo "HTTP Status: $STATUS"
cat /tmp/curl_body.txt

echo ""
echo "=== 5. curl 域名 ==="
STATUS2=$(curl -s -o /tmp/curl_body2.txt -w "%{http_code}" http://papacheck.chengdexy.cn/.well-known/acme-challenge/test-token)
echo "HTTP Status: $STATUS2"
cat /tmp/curl_body2.txt

rm -f /var/www/certbot/.well-known/acme-challenge/test-token

echo ""
echo "=== 6. certbot renew --dry-run ==="
certbot renew --dry-run 2>&1 | tail -20
