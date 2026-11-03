/* eslint-disable no-useless-escape */
/**
 * Install the ACA monitoring agent on the BYO server.
 *
 * What it places:
 *   /usr/local/bin/aca-agent-report.sh   — bash agent (mail.log tail + mailq + systemctl + HMAC POST)
 *   /etc/aca-agent.env                   — secret + IDs (mode 600 root)
 *   /etc/cron.d/aca-agent                — cron entry: every minute
 *   /var/lib/aca/cursor                  — last-read offset of /var/log/mail.log
 *
 * The agent POSTs to <events_url> with header X-ACA-Signature: HMAC-SHA256(body, agent_secret).
 *
 * Bash $-substitutions are escaped as \${...} so JS doesn't interpolate them.
 *
 * Args (passed by deploy job): $1=server_id, $2=events_url, $3=agent_secret
 */

export const INSTALL_AGENT_SCRIPT = `#!/usr/bin/env bash
set -euxo pipefail

SERVER_ID="\${1:?server_id is required}"
EVENTS_URL="\${2:?events_url is required}"
AGENT_SECRET="\${3:?agent_secret is required}"

ENV_FILE=/etc/aca-agent.env
AGENT_BIN=/usr/local/bin/aca-agent-report.sh
CURSOR_DIR=/var/lib/aca
CURSOR_FILE="\${CURSOR_DIR}/cursor"
CRON_FILE=/etc/cron.d/aca-agent

mkdir -p "\${CURSOR_DIR}"
chown root:root "\${CURSOR_DIR}"
chmod 750 "\${CURSOR_DIR}"
[ -f "\${CURSOR_FILE}" ] || echo 0 > "\${CURSOR_FILE}"

# 1) Env file (secret + identity).
cat > "\${ENV_FILE}" <<EOF
ACA_SERVER_ID=\${SERVER_ID}
ACA_EVENTS_URL=\${EVENTS_URL}
ACA_AGENT_SECRET=\${AGENT_SECRET}
EOF
chown root:root "\${ENV_FILE}"
chmod 600 "\${ENV_FILE}"

# 2) Agent script. Reads incremental mail.log slice, parses Postfix events,
#    captures health snapshot, POSTs JSON with HMAC.
cat > "\${AGENT_BIN}" <<'AGENT_EOF'
#!/usr/bin/env bash
set -uo pipefail

# shellcheck disable=SC1091
source /etc/aca-agent.env

CURSOR_FILE=/var/lib/aca/cursor
LOCK_FILE=/var/lib/aca/lock
MAIL_LOG=/var/log/mail.log
[ -f "$MAIL_LOG" ] || MAIL_LOG=/var/log/maillog
[ -f "$MAIL_LOG" ] || { echo "no mail log found" >&2; exit 0; }

# Single-instance guard so a slow run doesn't double-fire from cron.
exec 9>"$LOCK_FILE"
flock -n 9 || exit 0

PREV_OFFSET=$(cat "$CURSOR_FILE" 2>/dev/null || echo 0)
SIZE=$(stat -c %s "$MAIL_LOG" 2>/dev/null || echo 0)

# Log rotation: if the file shrunk, start from 0.
if [ "$SIZE" -lt "$PREV_OFFSET" ]; then PREV_OFFSET=0; fi

SLICE=$(mktemp)
if [ "$SIZE" -gt "$PREV_OFFSET" ]; then
  dd if="$MAIL_LOG" bs=1 skip="$PREV_OFFSET" count=$((SIZE - PREV_OFFSET)) of="$SLICE" status=none 2>/dev/null || true
fi
echo "$SIZE" > "$CURSOR_FILE"

# Build events JSON. We use grep/sed instead of awk because heredoc + JS
# template-literal escaping makes embedded awk strings nightmarish to maintain.
EVENTS_JSON=$(
  while IFS= read -r line; do
    qid=$(printf '%s' "$line" | grep -oE '[A-Z0-9]{8,}: ' | head -1 | tr -d ': ')
    to=$(printf '%s' "$line" | grep -oE 'to=<[^>]+>' | head -1 | sed -e 's/^to=<//' -e 's/>$//')
    [ -z "$qid" ] && continue
    [ -z "$to" ] && continue
    if printf '%s' "$line" | grep -q 'status=sent'; then
      relay=$(printf '%s' "$line" | grep -oE 'relay=[^,]+' | head -1 | sed 's/^relay=//')
      printf '{"type":"send","queue_id":"%s","to":"%s","relay":"%s"}\\n' "$qid" "$to" "$relay"
    elif printf '%s' "$line" | grep -q 'status=bounced'; then
      reason=$(printf '%s' "$line" | sed -n 's/.*status=bounced (\\(.*\\))[^)]*$/\\1/p' | sed 's/"/\\\\"/g')
      printf '{"type":"bounce","queue_id":"%s","to":"%s","reason":"%s"}\\n' "$qid" "$to" "$reason"
    fi
  done < <(grep -E 'postfix/smtp(\\[|/)' "$SLICE" | grep -E 'status=(sent|bounced)') | head -n 500
)

rm -f "$SLICE"

# Build a single JSON array of events.
EVENTS_ARRAY="[]"
if [ -n "$EVENTS_JSON" ]; then
  EVENTS_ARRAY="[$(echo "$EVENTS_JSON" | paste -sd, -)]"
fi

# Health snapshot.
MAILQ_ACTIVE=$(mailq 2>/dev/null | tail -n 1 | grep -oE '[0-9]+ Request' | grep -oE '[0-9]+' || echo 0)
MAILQ_DEFERRED=$(find /var/spool/postfix/deferred -type f 2>/dev/null | wc -l || echo 0)
POSTFIX_STATE=$(systemctl is-active postfix 2>/dev/null || echo unknown)
OPENDKIM_STATE=$(systemctl is-active opendkim 2>/dev/null || echo unknown)
DOVECOT_STATE=$(systemctl is-active dovecot 2>/dev/null || echo unknown)
LOAD_1M=$(awk '{print $1}' /proc/loadavg 2>/dev/null || echo 0)
MEM_USED_MB=$(awk '/MemAvailable/ {avail=$2} /MemTotal/ {total=$2} END {print int((total-avail)/1024)}' /proc/meminfo 2>/dev/null || echo 0)

TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

read -r -d '' BODY <<JSON || true
{"server_id":"$ACA_SERVER_ID","ts":"$TS","events":$EVENTS_ARRAY,"health":{"mailq_active":$MAILQ_ACTIVE,"mailq_deferred":$MAILQ_DEFERRED,"postfix":"$POSTFIX_STATE","opendkim":"$OPENDKIM_STATE","dovecot":"$DOVECOT_STATE","load_1m":$LOAD_1M,"mem_used_mb":$MEM_USED_MB}}
JSON

# HMAC-SHA256 of body using agent secret.
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$ACA_AGENT_SECRET" -hex 2>/dev/null | awk '{print $NF}')

# Best-effort POST. Don't error the cron job on transient failures.
curl -fsS \\
  --max-time 8 \\
  -H "Content-Type: application/json" \\
  -H "X-ACA-Signature: $SIG" \\
  --data-binary "$BODY" \\
  "$ACA_EVENTS_URL" >/dev/null 2>&1 || true
AGENT_EOF

chown root:root "\${AGENT_BIN}"
chmod 750 "\${AGENT_BIN}"

# 3) Cron entry: run every minute.
cat > "\${CRON_FILE}" <<'EOF'
# Managed by ACA BYO deployer.
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin
* * * * * root /usr/local/bin/aca-agent-report.sh >/dev/null 2>&1
EOF
chown root:root "\${CRON_FILE}"
chmod 644 "\${CRON_FILE}"

# Reload cron (cron pickups /etc/cron.d on its own usually, but force it)
if systemctl list-units --full -all 2>/dev/null | grep -q '^cron.service'; then
  systemctl restart cron 2>/dev/null || true
elif systemctl list-units --full -all 2>/dev/null | grep -q '^crond.service'; then
  systemctl restart crond 2>/dev/null || true
fi

echo "[install-agent] installed agent for server \${SERVER_ID}"
`;
