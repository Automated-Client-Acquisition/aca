/* eslint-disable no-useless-escape */
/**
 * Idempotent installation of the BYO mail stack on a Debian/Ubuntu server.
 *
 * Embedded as a TS string literal so the bundled deployer is self-contained.
 * Bash $-substitutions are escaped as \${...} so JS doesn't try to interpolate.
 * Other \$X forms are kept for visual consistency with bash.
 */

export const INSTALL_BASE_SCRIPT = `#!/usr/bin/env bash
set -euxo pipefail
export DEBIAN_FRONTEND=noninteractive

# Quick path: skip apt churn if everything's already in place.
if command -v postfix >/dev/null 2>&1 \\
   && command -v opendkim >/dev/null 2>&1 \\
   && command -v dovecot >/dev/null 2>&1 \\
   && [ -x /usr/lib/dovecot/lmtp ] \\
   && command -v ufw >/dev/null 2>&1 \\
   && command -v fail2ban-server >/dev/null 2>&1; then
  echo "[install-base] all packages already present"
else
  apt-get update -y
  echo "postfix postfix/main_mailer_type select Internet Site" | debconf-set-selections
  echo "postfix postfix/mailname string \$(hostname -f)" | debconf-set-selections
  apt-get install -y --no-install-recommends \\
    postfix postfix-pcre \\
    opendkim opendkim-tools \\
    dovecot-imapd dovecot-lmtpd dovecot-core \\
    ufw fail2ban \\
    ca-certificates curl bash-completion \\
    libsasl2-modules sasl2-bin
fi

# /var/mail/vhosts hosts virtual mailboxes (Maildir per address).
if ! id vmail >/dev/null 2>&1; then
  groupadd --system --gid 5000 vmail || true
  useradd --system --uid 5000 --gid 5000 --home /var/mail/vhosts --shell /usr/sbin/nologin vmail
fi
mkdir -p /var/mail/vhosts
chown -R vmail:vmail /var/mail/vhosts
chmod 770 /var/mail/vhosts

# Per-domain Postfix maps (postmapped on every provision).
mkdir -p /etc/postfix/byo
touch /etc/postfix/byo/virtual_domains \\
      /etc/postfix/byo/virtual_aliases \\
      /etc/postfix/byo/virtual_mailboxes \\
      /etc/postfix/byo/sender_transport
chmod 644 /etc/postfix/byo/*

# OpenDKIM tables.
mkdir -p /etc/opendkim/keys
chown -R opendkim:opendkim /etc/opendkim/keys 2>/dev/null || true
touch /etc/opendkim/key.table /etc/opendkim/signing.table /etc/opendkim/trusted.hosts
grep -qE '^127\\.0\\.0\\.1\$' /etc/opendkim/trusted.hosts || echo "127.0.0.1" >> /etc/opendkim/trusted.hosts
grep -qE '^localhost\$'    /etc/opendkim/trusted.hosts || echo "localhost"  >> /etc/opendkim/trusted.hosts

# UFW.
ufw allow 22/tcp   >/dev/null 2>&1 || true
ufw allow 25/tcp   >/dev/null 2>&1 || true
ufw allow 465/tcp  >/dev/null 2>&1 || true
ufw allow 587/tcp  >/dev/null 2>&1 || true
ufw allow 993/tcp  >/dev/null 2>&1 || true
yes | ufw enable >/dev/null 2>&1 || true

# Capture versions.
{
  printf 'POSTFIX_VERSION='
  postconf -d mail_version 2>/dev/null | awk -F'= ' '{print \$2}' | tr -d '\\n'
  printf '\\n'
  printf 'OPENDKIM_VERSION='
  opendkim -V 2>&1 | head -n1 | awk '{print \$NF}' | tr -d '\\n'
  printf '\\n'
  printf 'DOVECOT_VERSION='
  dovecot --version 2>/dev/null | tr -d '\\n'
  printf '\\n'
} > /tmp/aca-versions

cat /tmp/aca-versions
echo "[install-base] done"
`;
