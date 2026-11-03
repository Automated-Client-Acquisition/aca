/* eslint-disable no-useless-escape */
/**
 * Remove a virtual mailbox from the BYO server.
 *
 * Args: $1=email_address  $2=delete_maildir (yes/no, default no)
 *
 * Removes:
 *   - SASL passdb entry from /etc/dovecot/byo-passwd
 *   - Postfix virtual_mailboxes entry (postmapped)
 *   - Sender-transport pin from /etc/postfix/byo/sender_transport (postmapped)
 *   - (Optional) Maildir at /var/mail/vhosts/<domain>/<user>/
 *
 * Idempotent — no-op if entries don't exist. Reloads dovecot + postfix at end.
 *
 * Bash $-substitutions are escaped as \${...} so JS doesn't interpolate them.
 */

export const REMOVE_MAILBOX_SCRIPT = `#!/usr/bin/env bash
set -euxo pipefail

EMAIL="\${1:?email is required}"
DELETE_MAILDIR="\${2:-no}"

USER="\${EMAIL%@*}"
DOMAIN="\${EMAIL#*@}"
if [ -z "\${USER}" ] || [ -z "\${DOMAIN}" ] || [ "\${USER}" = "\${EMAIL}" ]; then
  echo "[remove-mailbox] invalid email format: \${EMAIL}" >&2
  exit 1
fi

# 1) Dovecot passwd file
PASSWD_FILE=/etc/dovecot/byo-passwd
if [ -f "\${PASSWD_FILE}" ]; then
  TMP="\$(mktemp)"
  grep -v "^\${EMAIL}:" "\${PASSWD_FILE}" > "\${TMP}" || true
  mv "\${TMP}" "\${PASSWD_FILE}"
  chown root:dovecot "\${PASSWD_FILE}"
  chmod 640 "\${PASSWD_FILE}"
fi

# 2) Postfix virtual_mailboxes
VMBX=/etc/postfix/byo/virtual_mailboxes
if [ -f "\${VMBX}" ]; then
  TMP="\$(mktemp)"
  grep -v "^\${EMAIL}\\\\b" "\${VMBX}" > "\${TMP}" || true
  mv "\${TMP}" "\${VMBX}"
  postmap "\${VMBX}"
fi

# 3) Sender-transport pin
ST=/etc/postfix/byo/sender_transport
if [ -f "\${ST}" ]; then
  TMP="\$(mktemp)"
  grep -v "^\${EMAIL}\\\\b" "\${ST}" > "\${TMP}" || true
  mv "\${TMP}" "\${ST}"
  postmap "\${ST}"
fi

# 4) Maildir (only if explicitly requested — protects against accidental data loss)
if [ "\${DELETE_MAILDIR}" = "yes" ]; then
  MAIL_DIR="/var/mail/vhosts/\${DOMAIN}/\${USER}"
  if [ -d "\${MAIL_DIR}" ]; then
    rm -rf "\${MAIL_DIR}"
  fi
fi

systemctl reload dovecot || systemctl restart dovecot
systemctl reload postfix || systemctl restart postfix

echo "ACA_MAILBOX_REMOVED=\${EMAIL}"
`;
