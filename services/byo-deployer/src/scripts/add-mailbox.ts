/* eslint-disable no-useless-escape */
/**
 * Provision a virtual mailbox on a deployed BYO server.
 *
 * Args: $1=email_address  $2=plaintext_password  $3=display_name (optional)
 *
 * - Creates Maildir at /var/mail/vhosts/<domain>/<user>/ with vmail:vmail
 * - Hashes password with `doveadm pw -s SHA512-CRYPT` and appends to /etc/dovecot/byo-passwd
 *   (replaces existing line if the user already exists)
 * - Adds entry to /etc/postfix/byo/virtual_mailboxes and postmaps
 * - Reloads dovecot + postfix
 *
 * Idempotent: re-running with the same email rotates the password.
 *
 * Bash $-substitutions are escaped as \${...} so JS doesn't interpolate.
 */

export const ADD_MAILBOX_SCRIPT = `#!/usr/bin/env bash
set -euxo pipefail

EMAIL="\${1:?email is required}"
PASSWORD="\${2:?password is required}"
DISPLAY_NAME="\${3:-}"

USER="\${EMAIL%@*}"
DOMAIN="\${EMAIL#*@}"

if [ -z "\${USER}" ] || [ -z "\${DOMAIN}" ] || [ "\${USER}" = "\${EMAIL}" ]; then
  echo "[add-mailbox] invalid email format: \${EMAIL}" >&2
  exit 1
fi

# 1) Maildir
MAIL_DIR="/var/mail/vhosts/\${DOMAIN}/\${USER}"
mkdir -p "\${MAIL_DIR}/cur" "\${MAIL_DIR}/new" "\${MAIL_DIR}/tmp"
chown -R vmail:vmail "/var/mail/vhosts/\${DOMAIN}"
chmod -R 770 "/var/mail/vhosts/\${DOMAIN}"

# 2) Password hash (SHA512-CRYPT — matches dovecot.conf passdb scheme)
HASH="\$(doveadm pw -s SHA512-CRYPT -p "\${PASSWORD}")"

# Replace any existing line for this user (idempotent password rotation).
PASSWD_FILE=/etc/dovecot/byo-passwd
touch "\${PASSWD_FILE}"
TMP="\$(mktemp)"
grep -v "^\${EMAIL}:" "\${PASSWD_FILE}" > "\${TMP}" || true
echo "\${EMAIL}:\${HASH}" >> "\${TMP}"
mv "\${TMP}" "\${PASSWD_FILE}"
chown root:dovecot "\${PASSWD_FILE}"
chmod 640 "\${PASSWD_FILE}"

# 3) Postfix virtual_mailboxes (add if missing — postmap is idempotent)
VMBX=/etc/postfix/byo/virtual_mailboxes
touch "\${VMBX}"
if ! grep -qE "^\${EMAIL}\\\\b" "\${VMBX}"; then
  echo "\${EMAIL}    \${DOMAIN}/\${USER}/" >> "\${VMBX}"
fi
postmap "\${VMBX}"

# 4) Reload services so new auth + map take effect immediately.
systemctl reload dovecot || systemctl restart dovecot
systemctl reload postfix || systemctl restart postfix

echo "ACA_MAILBOX_BEGIN"
echo "EMAIL=\${EMAIL}"
echo "DOMAIN=\${DOMAIN}"
echo "USER=\${USER}"
echo "MAIL_DIR=\${MAIL_DIR}"
echo "DISPLAY_NAME=\${DISPLAY_NAME}"
echo "ACA_MAILBOX_END"
`;
