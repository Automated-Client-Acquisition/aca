/* eslint-disable no-useless-escape */
/**
 * Remove a domain from the BYO server.
 *
 * Args: $1=domain  $2=selector (default aca1)  $3=delete_keys (yes/no, default no)
 *
 * Removes:
 *   - Postfix virtual_domains entry (postmapped)
 *   - All Postfix virtual_mailboxes entries for *@domain (postmapped)
 *   - All sender_transport pins for *@domain (postmapped)
 *   - All Dovecot passdb entries for *@domain
 *   - OpenDKIM key.table + signing.table + trusted.hosts entries
 *   - (Optional) DKIM keypair at /etc/opendkim/keys/<domain>/
 *
 * Idempotent. Reloads opendkim + postfix + dovecot at end.
 *
 * Bash $-substitutions are escaped as \${...} so JS doesn't interpolate them.
 */

export const REMOVE_DOMAIN_SCRIPT = `#!/usr/bin/env bash
set -euxo pipefail

DOMAIN="\${1:?domain is required}"
SELECTOR="\${2:-aca1}"
DELETE_KEYS="\${3:-no}"

# 1) Postfix virtual_domains
VD=/etc/postfix/byo/virtual_domains
if [ -f "\${VD}" ]; then
  TMP="\$(mktemp)"
  grep -v "^\${DOMAIN}\\\\b" "\${VD}" > "\${TMP}" || true
  mv "\${TMP}" "\${VD}"
  postmap "\${VD}"
fi

# 2) Postfix virtual_mailboxes — drop all *@domain entries
VMBX=/etc/postfix/byo/virtual_mailboxes
if [ -f "\${VMBX}" ]; then
  TMP="\$(mktemp)"
  grep -v "@\${DOMAIN}\\\\b" "\${VMBX}" > "\${TMP}" || true
  mv "\${TMP}" "\${VMBX}"
  postmap "\${VMBX}"
fi

# 3) Postfix sender_transport — drop *@domain pins
ST=/etc/postfix/byo/sender_transport
if [ -f "\${ST}" ]; then
  TMP="\$(mktemp)"
  grep -v "@\${DOMAIN}\\\\b" "\${ST}" > "\${TMP}" || true
  mv "\${TMP}" "\${ST}"
  postmap "\${ST}"
fi

# 4) Dovecot passdb — drop *@domain entries
PASSWD_FILE=/etc/dovecot/byo-passwd
if [ -f "\${PASSWD_FILE}" ]; then
  TMP="\$(mktemp)"
  grep -v "@\${DOMAIN}:" "\${PASSWD_FILE}" > "\${TMP}" || true
  mv "\${TMP}" "\${PASSWD_FILE}"
  chown root:dovecot "\${PASSWD_FILE}"
  chmod 640 "\${PASSWD_FILE}"
fi

# 5) OpenDKIM tables
KEY_TABLE=/etc/opendkim/key.table
SIG_TABLE=/etc/opendkim/signing.table
TRUSTED=/etc/opendkim/trusted.hosts
for f in "\${KEY_TABLE}" "\${SIG_TABLE}" "\${TRUSTED}"; do
  [ -f "\$f" ] || continue
  TMP="\$(mktemp)"
  grep -v "\\\\b\${DOMAIN}\\\\b" "\$f" > "\${TMP}" || true
  mv "\${TMP}" "\$f"
done

# 6) DKIM keypair (only if explicitly requested — keys are precious)
if [ "\${DELETE_KEYS}" = "yes" ]; then
  KEY_DIR="/etc/opendkim/keys/\${DOMAIN}"
  if [ -d "\${KEY_DIR}" ]; then
    rm -rf "\${KEY_DIR}"
  fi
fi

# 7) Mail vhost dir (only when keys deleted — implies full domain teardown)
if [ "\${DELETE_KEYS}" = "yes" ]; then
  MAIL_DOMAIN_DIR="/var/mail/vhosts/\${DOMAIN}"
  if [ -d "\${MAIL_DOMAIN_DIR}" ]; then
    rm -rf "\${MAIL_DOMAIN_DIR}"
  fi
fi

systemctl reload opendkim || systemctl restart opendkim
systemctl reload postfix  || systemctl restart postfix
systemctl reload dovecot  || systemctl restart dovecot

echo "ACA_DOMAIN_REMOVED=\${DOMAIN}"
`;
