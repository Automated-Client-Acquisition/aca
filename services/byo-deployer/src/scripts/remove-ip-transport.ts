/* eslint-disable no-useless-escape */
/**
 * Remove an outbound IP transport from Postfix and unbind any mailbox that
 * was pinned to it.
 *
 * Args: $1=ip
 *
 * Idempotent: no-op if the transport was never registered.
 */

export const REMOVE_IP_TRANSPORT_SCRIPT = `#!/usr/bin/env bash
set -euxo pipefail

IP="\${1:?ip is required}"
TRANSPORT_NAME="smtp-out-\${IP//./-}"
MASTER=/etc/postfix/master.cf
SENDER_TRANSPORT=/etc/postfix/byo/sender_transport

# 1) Strip the per-IP block from master.cf. Match the comment header through
#    the next blank line / next non-indented line so we cleanly excise it.
if grep -qE "^\${TRANSPORT_NAME}\\\\s+unix" "\${MASTER}"; then
  python3 - "\${MASTER}" "\${TRANSPORT_NAME}" <<'PY'
import re, sys
path, transport = sys.argv[1], sys.argv[2]
with open(path) as f:
    lines = f.readlines()
out, skipping = [], False
header = re.compile(r'^# Managed by ACA BYO deployer — outbound transport bound to ')
unix = re.compile(r'^' + re.escape(transport) + r'\\s+unix')
i = 0
while i < len(lines):
    line = lines[i]
    if not skipping and (header.search(line) or unix.search(line)):
        skipping = True
        # Drop the matched line; continue while next lines start with whitespace.
        i += 1
        while i < len(lines) and (lines[i].startswith((' ', '\\t')) or unix.search(lines[i])):
            i += 1
        # also drop one trailing blank line if present
        if i < len(lines) and lines[i].strip() == '':
            i += 1
        skipping = False
    else:
        out.append(line)
        i += 1
with open(path, 'w') as f:
    f.writelines(out)
PY
fi

# 2) Strip any mailbox -> this transport mappings from sender_transport so
#    affected mailboxes fall back to default routing.
if [ -f "\${SENDER_TRANSPORT}" ]; then
  TMP="\$(mktemp)"
  grep -v "\\\\s\${TRANSPORT_NAME}:\\\\s*$" "\${SENDER_TRANSPORT}" > "\${TMP}" || true
  mv "\${TMP}" "\${SENDER_TRANSPORT}"
  postmap "\${SENDER_TRANSPORT}"
fi

systemctl reload postfix || systemctl restart postfix

echo "ACA_IP_TRANSPORT_REMOVED=\${IP}"
`;
