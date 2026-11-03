/* eslint-disable no-useless-escape */
/**
 * Provision a Let's Encrypt cert for the mail server's HELO hostname and swap
 * Postfix + Dovecot from snakeoil to the LE cert.
 *
 * Args:
 *   $1=helo_hostname    must resolve to one of the server's IPs (A record)
 *   $2=admin_email      certbot account / renewal notification address
 *
 * Strategy:
 *   - certbot --standalone (binds :80) — no web server required
 *   - --non-interactive --agree-tos --email <admin>
 *   - Renewal: certbot installs systemd timer by default. We add a deploy-hook
 *     that reloads postfix + dovecot whenever the cert renews.
 *   - Idempotent: if cert exists and is valid, skip and just swap configs.
 *
 * Bash $-substitutions are escaped as \${...} so JS doesn't interpolate them.
 */

export const INSTALL_TLS_SCRIPT = `#!/usr/bin/env bash
set -euxo pipefail
export DEBIAN_FRONTEND=noninteractive

HELO="\${1:?helo_hostname is required}"
ADMIN_EMAIL="\${2:?admin_email is required}"

LIVE_DIR="/etc/letsencrypt/live/\${HELO}"
HOOK_DIR="/etc/letsencrypt/renewal-hooks/deploy"

# 1) Install certbot if missing.
if ! command -v certbot >/dev/null 2>&1; then
  apt-get update -y
  apt-get install -y --no-install-recommends certbot
fi

# 2) Verify the HELO name resolves to a local IP. certbot's standalone challenge
#    won't reach the box otherwise. We accept any local interface.
RESOLVED_IP="\$(getent ahostsv4 "\${HELO}" 2>/dev/null | awk 'NR==1 {print \$1}' || true)"
if [ -z "\${RESOLVED_IP}" ]; then
  echo "[install-tls] ERROR: \${HELO} does not resolve. Set its A record to a server IP first." >&2
  exit 2
fi
if ! ip -4 addr show | grep -qE "inet \${RESOLVED_IP}/"; then
  echo "[install-tls] ERROR: \${HELO} resolves to \${RESOLVED_IP}, which is not bound to any local interface." >&2
  echo "[install-tls] Set the A record to one of the server's IPs and retry." >&2
  exit 3
fi

# 3) Make sure port 80 is free for certbot's standalone challenge.
#    BYO mail stack doesn't run a web server, so this is rarely an issue.
if ss -tlnp 2>/dev/null | awk '{print \$4}' | grep -qE ':80\$'; then
  echo "[install-tls] WARN: something is listening on port 80; certbot --standalone may fail."
fi
ufw allow 80/tcp >/dev/null 2>&1 || true

# 4) Issue or renew the cert.
if [ -f "\${LIVE_DIR}/fullchain.pem" ]; then
  certbot renew --quiet --no-random-sleep-on-renew --deploy-hook 'systemctl reload postfix dovecot' || true
else
  certbot certonly \\
    --standalone \\
    --non-interactive --agree-tos \\
    --email "\${ADMIN_EMAIL}" \\
    --preferred-challenges http \\
    --rsa-key-size 4096 \\
    -d "\${HELO}"
fi

# 5) Persistent renewal hook. Runs every time certbot renews any cert.
mkdir -p "\${HOOK_DIR}"
cat > "\${HOOK_DIR}/aca-byo-mail-reload.sh" <<'EOF'
#!/usr/bin/env bash
# Managed by ACA BYO deployer — reload mail stack on cert renewal.
systemctl reload postfix 2>/dev/null || systemctl restart postfix || true
systemctl reload dovecot 2>/dev/null || systemctl restart dovecot || true
EOF
chmod 755 "\${HOOK_DIR}/aca-byo-mail-reload.sh"

# 6) Swap Postfix to the new cert.
postconf -e "smtpd_tls_cert_file=\${LIVE_DIR}/fullchain.pem"
postconf -e "smtpd_tls_key_file=\${LIVE_DIR}/privkey.pem"
postconf -e "smtpd_tls_security_level=may"
postconf -e "smtp_tls_security_level=may"

# 7) Swap Dovecot to the new cert.
ACA_DOVECOT_CONF=/etc/dovecot/conf.d/aca-byo.conf
if [ -f "\${ACA_DOVECOT_CONF}" ]; then
  sed -i "s|^ssl_cert = </etc/ssl/certs/ssl-cert-snakeoil.pem|ssl_cert = <\${LIVE_DIR}/fullchain.pem|" "\${ACA_DOVECOT_CONF}"
  sed -i "s|^ssl_key  = </etc/ssl/private/ssl-cert-snakeoil.key|ssl_key  = <\${LIVE_DIR}/privkey.pem|" "\${ACA_DOVECOT_CONF}"
fi

systemctl reload postfix
systemctl reload dovecot

# 8) Emit cert metadata for the deployer to capture.
NOT_AFTER="\$(openssl x509 -in "\${LIVE_DIR}/fullchain.pem" -noout -enddate 2>/dev/null | sed 's/notAfter=//' || echo unknown)"
ISSUER="\$(openssl x509 -in "\${LIVE_DIR}/fullchain.pem" -noout -issuer 2>/dev/null | sed 's/issuer=//' || echo unknown)"
SUBJECT="\$(openssl x509 -in "\${LIVE_DIR}/fullchain.pem" -noout -subject 2>/dev/null | sed 's/subject=//' || echo unknown)"

echo "ACA_TLS_BEGIN"
echo "HELO=\${HELO}"
echo "CERT_PATH=\${LIVE_DIR}/fullchain.pem"
echo "KEY_PATH=\${LIVE_DIR}/privkey.pem"
echo "NOT_AFTER=\${NOT_AFTER}"
echo "ISSUER=\${ISSUER}"
echo "SUBJECT=\${SUBJECT}"
echo "ACA_TLS_END"
`;
