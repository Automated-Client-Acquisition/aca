/* eslint-disable no-useless-escape */
/**
 * Register an additional outbound IP with Postfix.
 *
 * Args: $1=ip  $2=helo_name (optional, defaults to <ip-with-dashes>.<server-hostname>)
 *
 * Verifies the IP is bound to a NIC (otherwise smtp_bind_address fails silently
 * at queue time), then appends a per-IP smtp transport block to master.cf.
 * Idempotent: skips if "smtp-out-<ip>" is already defined.
 *
 * Bash $-substitutions are escaped as \${...} so JS doesn't interpolate.
 */

export const ADD_IP_TRANSPORT_SCRIPT = `#!/usr/bin/env bash
set -euxo pipefail

IP="\${1:?ip is required}"
DEFAULT_HELO="\${IP//./-}.\$(hostname -f)"
HELO="\${2:-\${DEFAULT_HELO}}"

# 1) Verify IP is actually bound to a local interface — Postfix won't error
# at config time, but mail will silently get stuck in deferred queue otherwise.
if ! ip -4 addr show | grep -qE "inet \${IP}/"; then
  echo "[add-ip-transport] ERROR: \${IP} is not bound to any local interface" >&2
  echo "[add-ip-transport] Have your provider attach \${IP} to this server's NIC, or run:" >&2
  echo "  ip addr add \${IP}/32 dev \$(ip -4 route show default | awk '{print \$5}' | head -n1)" >&2
  exit 2
fi

# 2) Append to master.cf if not already present.
TRANSPORT_NAME="smtp-out-\${IP//./-}"
MASTER=/etc/postfix/master.cf

if grep -qE "^\${TRANSPORT_NAME}\\\\s+unix" "\${MASTER}"; then
  echo "[add-ip-transport] transport \${TRANSPORT_NAME} already configured"
else
  cat >> "\${MASTER}" <<EOF

# Managed by ACA BYO deployer — outbound transport bound to \${IP}
\${TRANSPORT_NAME} unix - - n - - smtp
  -o syslog_name=postfix/\${TRANSPORT_NAME}
  -o smtp_bind_address=\${IP}
  -o smtp_helo_name=\${HELO}
EOF
fi

systemctl reload postfix || systemctl restart postfix

echo "ACA_IP_TRANSPORT_BEGIN"
echo "IP=\${IP}"
echo "TRANSPORT=\${TRANSPORT_NAME}"
echo "HELO=\${HELO}"
echo "ACA_IP_TRANSPORT_END"
`;
