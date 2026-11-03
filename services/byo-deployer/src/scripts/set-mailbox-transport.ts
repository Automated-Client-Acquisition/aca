/* eslint-disable no-useless-escape */
/**
 * Pin a mailbox's outbound mail to a specific IP transport.
 *
 * Args: $1=email_address  $2=ip   (or $2="default" to remove the pin)
 *
 * Writes to /etc/postfix/byo/sender_transport and postmaps. Idempotent —
 * replaces any existing line for the email address.
 *
 * Bash $-substitutions are escaped as \${...} so JS doesn't interpolate.
 */

export const SET_MAILBOX_TRANSPORT_SCRIPT = `#!/usr/bin/env bash
set -euxo pipefail

EMAIL="\${1:?email is required}"
IP="\${2:?ip is required (use 'default' to remove the pin)}"

SENDER_TRANSPORT=/etc/postfix/byo/sender_transport
mkdir -p "\$(dirname \${SENDER_TRANSPORT})"
touch "\${SENDER_TRANSPORT}"

# Drop any existing line for this email so we can replace cleanly.
TMP="\$(mktemp)"
grep -v "^\${EMAIL}\\\\s" "\${SENDER_TRANSPORT}" > "\${TMP}" || true

if [ "\${IP}" = "default" ]; then
  # Removing the pin → falls back to default smtp transport.
  mv "\${TMP}" "\${SENDER_TRANSPORT}"
else
  TRANSPORT_NAME="smtp-out-\${IP//./-}"
  # Verify the per-IP transport actually exists in master.cf.
  if ! grep -qE "^\${TRANSPORT_NAME}\\\\s+unix" /etc/postfix/master.cf; then
    rm -f "\${TMP}"
    echo "[set-mailbox-transport] ERROR: transport \${TRANSPORT_NAME} is not registered. Run add-ip-transport.sh first." >&2
    exit 3
  fi
  echo "\${EMAIL}    \${TRANSPORT_NAME}:" >> "\${TMP}"
  mv "\${TMP}" "\${SENDER_TRANSPORT}"
fi

postmap "\${SENDER_TRANSPORT}"
systemctl reload postfix || systemctl restart postfix

echo "ACA_MAILBOX_TRANSPORT_BEGIN"
echo "EMAIL=\${EMAIL}"
echo "IP=\${IP}"
echo "ACA_MAILBOX_TRANSPORT_END"
`;
