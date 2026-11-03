/* eslint-disable no-useless-escape */
/**
 * Provision a domain on a deployed BYO server. Idempotent.
 *
 * Args: $1=domain  $2=selector (default aca1)  $3=public_ip (optional override)
 *       $4=mail_host (server HELO hostname — becomes the MX target)
 *       $5=dmarc_rua (optional aggregate-report address; defaults to dmarc@<domain>)
 *
 * Bash $-substitutions are escaped as \${...} so JS template literal doesn't
 * try to interpolate them. Other \$X forms are kept for visual consistency.
 */

export const ADD_DOMAIN_SCRIPT = `#!/usr/bin/env bash
set -euxo pipefail

DOMAIN="\${1:?domain is required}"
SELECTOR="\${2:-aca1}"
PUBLIC_IP="\${3:-}"
MAIL_HOST="\${4:-}"
DMARC_RUA="\${5:-}"

KEY_DIR="/etc/opendkim/keys/\${DOMAIN}"
PRIV_KEY="\${KEY_DIR}/\${SELECTOR}.private"
PUB_KEY_TXT="\${KEY_DIR}/\${SELECTOR}.txt"

mkdir -p "\${KEY_DIR}"
chown opendkim:opendkim "\${KEY_DIR}"
if [ ! -s "\${PRIV_KEY}" ]; then
  opendkim-genkey --bits=2048 --domain="\${DOMAIN}" --selector="\${SELECTOR}" --directory="\${KEY_DIR}"
  mv "\${KEY_DIR}/\${SELECTOR}.private" "\${PRIV_KEY}"
  mv "\${KEY_DIR}/\${SELECTOR}.txt"     "\${PUB_KEY_TXT}"
fi
chown opendkim:opendkim "\${PRIV_KEY}" "\${PUB_KEY_TXT}"
chmod 600 "\${PRIV_KEY}"

KEY_TABLE_LINE="\${SELECTOR}._domainkey.\${DOMAIN} \${DOMAIN}:\${SELECTOR}:\${PRIV_KEY}"
SIG_TABLE_LINE="*@\${DOMAIN} \${SELECTOR}._domainkey.\${DOMAIN}"

grep -qF "\${KEY_TABLE_LINE}" /etc/opendkim/key.table     || echo "\${KEY_TABLE_LINE}" >> /etc/opendkim/key.table
grep -qF "\${SIG_TABLE_LINE}" /etc/opendkim/signing.table || echo "\${SIG_TABLE_LINE}" >> /etc/opendkim/signing.table
grep -qF "\${DOMAIN}"         /etc/opendkim/trusted.hosts || echo "\${DOMAIN}"         >> /etc/opendkim/trusted.hosts

if ! grep -qE "^\${DOMAIN}\\\\b" /etc/postfix/byo/virtual_domains; then
  echo "\${DOMAIN} OK" >> /etc/postfix/byo/virtual_domains
  postmap /etc/postfix/byo/virtual_domains
fi

systemctl reload opendkim || systemctl restart opendkim
systemctl reload postfix  || systemctl restart postfix

PUBLIC_IP_OUT="\${PUBLIC_IP}"
if [ -z "\${PUBLIC_IP_OUT}" ]; then
  PUBLIC_IP_OUT="\$(curl -4 -fsS --max-time 5 https://ifconfig.io 2>/dev/null || echo '')"
fi

DKIM_ONELINE="\$(grep -oE '"[^"]+"' "\${PUB_KEY_TXT}" | sed 's/^"//; s/"\$//' | tr -d '\\n')"

if [ -z "\${DMARC_RUA}" ]; then
  DMARC_RUA="dmarc@\${DOMAIN}"
fi

echo "ACA_DNS_RECORDS_BEGIN"
echo "DOMAIN=\${DOMAIN}"
echo "SELECTOR=\${SELECTOR}"
echo "PUBLIC_IP=\${PUBLIC_IP_OUT}"
echo "DKIM_HOST=\${SELECTOR}._domainkey.\${DOMAIN}"
echo "DKIM_VALUE=\${DKIM_ONELINE}"
if [ -n "\${PUBLIC_IP_OUT}" ]; then
  echo "SPF_VALUE=v=spf1 ip4:\${PUBLIC_IP_OUT} -all"
else
  echo "SPF_VALUE=v=spf1 -all"
fi
# Inbound. Postfix already accepts this domain (virtual_domains above), but
# without an MX record nothing on the internet knows to deliver here — replies
# and DMARC aggregate reports bounce at the sender.
if [ -n "\${MAIL_HOST}" ]; then
  echo "MX_HOST=\${DOMAIN}"
  echo "MX_VALUE=\${MAIL_HOST}"
  echo "MX_PRIORITY=10"
fi
echo "DMARC_HOST=_dmarc.\${DOMAIN}"
echo "DMARC_VALUE=v=DMARC1; p=reject; sp=reject; rua=mailto:\${DMARC_RUA}; ruf=mailto:\${DMARC_RUA}; fo=0:1:d:s; adkim=s; aspf=s; pct=100"
echo "ACA_DNS_RECORDS_END"
`;
