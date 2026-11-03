/* eslint-disable no-useless-escape */
/**
 * Base Postfix + OpenDKIM + Dovecot configuration. Idempotent.
 *
 * Bash $-substitutions are escaped as \${...} so JS template literal doesn't
 * try to interpolate them. Other \$X forms are kept for visual consistency.
 */

export const CONFIGURE_BASE_SCRIPT = `#!/usr/bin/env bash
set -euxo pipefail

HELO_NAME="\${1:-\$(hostname -f)}"

# ── Postfix ────────────────────────────────────────────────────────────────
[ -f /etc/postfix/main.cf.aca-orig ] || cp /etc/postfix/main.cf /etc/postfix/main.cf.aca-orig

cat > /etc/postfix/main.cf <<EOF
# Managed by ACA BYO deployer.
compatibility_level = 3.6
smtpd_banner = \\\$myhostname ESMTP
biff = no
append_dot_mydomain = no
readme_directory = no

myhostname = \${HELO_NAME}
myorigin = /etc/mailname
# Accept our own hostname locally so system mail to root@hostname doesn't loop
# back via SMTP. /etc/aliases routes root → /dev/null below, discarding the noise.
mydestination = \\\$myhostname, localhost
mynetworks = 127.0.0.0/8 [::ffff:127.0.0.0]/104 [::1]/128
inet_interfaces = all
inet_protocols = ipv4

virtual_mailbox_domains = hash:/etc/postfix/byo/virtual_domains
virtual_alias_maps      = hash:/etc/postfix/byo/virtual_aliases
virtual_mailbox_maps    = hash:/etc/postfix/byo/virtual_mailboxes
virtual_mailbox_base    = /var/mail/vhosts
virtual_uid_maps        = static:5000
virtual_gid_maps        = static:5000
virtual_transport       = lmtp:unix:private/dovecot-lmtp

smtpd_sasl_auth_enable = yes
smtpd_sasl_type = dovecot
smtpd_sasl_path = private/auth
smtpd_sasl_security_options = noanonymous
smtpd_sasl_local_domain = \\\$myhostname
broken_sasl_auth_clients = yes

smtpd_tls_cert_file = /etc/ssl/certs/ssl-cert-snakeoil.pem
smtpd_tls_key_file  = /etc/ssl/private/ssl-cert-snakeoil.key
smtpd_use_tls = yes
smtpd_tls_security_level = may
smtp_tls_security_level  = may
smtpd_tls_session_cache_database = btree:\\\${data_directory}/smtpd_scache
smtp_tls_session_cache_database  = btree:\\\${data_directory}/smtp_scache

milter_protocol = 6
milter_default_action = accept
smtpd_milters     = inet:localhost:8891
non_smtpd_milters = inet:localhost:8891

smtpd_relay_restrictions = permit_mynetworks, permit_sasl_authenticated, defer_unauth_destination
smtpd_recipient_restrictions = permit_mynetworks, permit_sasl_authenticated, reject_unauth_destination

sender_dependent_default_transport_maps = hash:/etc/postfix/byo/sender_transport
EOF

cat > /etc/postfix/master.cf <<'EOF'
# Managed by ACA BYO deployer.
smtp      inet  n       -       y       -       -       smtpd
submission inet n       -       y       -       -       smtpd
  -o syslog_name=postfix/submission
  -o smtpd_tls_security_level=encrypt
  -o smtpd_sasl_auth_enable=yes
  -o smtpd_relay_restrictions=permit_sasl_authenticated,reject
smtps     inet  n       -       y       -       -       smtpd
  -o syslog_name=postfix/smtps
  -o smtpd_tls_wrappermode=yes
  -o smtpd_sasl_auth_enable=yes
  -o smtpd_relay_restrictions=permit_sasl_authenticated,reject
pickup    unix  n       -       y       60      1       pickup
cleanup   unix  n       -       y       -       0       cleanup
qmgr      unix  n       -       n       300     1       qmgr
tlsmgr    unix  -       -       y       1000?   1       tlsmgr
rewrite   unix  -       -       y       -       -       trivial-rewrite
bounce    unix  -       -       y       -       0       bounce
defer     unix  -       -       y       -       0       bounce
trace     unix  -       -       y       -       0       bounce
verify    unix  -       -       y       -       1       verify
flush     unix  n       -       y       1000?   0       flush
proxymap  unix  -       -       n       -       -       proxymap
proxywrite unix -       -       n       -       1       proxymap
smtp      unix  -       -       y       -       -       smtp
relay     unix  -       -       y       -       -       smtp
showq     unix  n       -       y       -       -       showq
error     unix  -       -       y       -       -       error
retry     unix  -       -       y       -       -       error
discard   unix  -       -       y       -       -       discard
local     unix  -       n       n       -       -       local
virtual   unix  -       n       n       -       -       virtual
lmtp      unix  -       -       y       -       -       lmtp
anvil     unix  -       -       y       -       1       anvil
scache    unix  -       -       y       -       1       scache
EOF

echo "\${HELO_NAME}" > /etc/mailname

# Discard system mail to root (cron, kernel, fail2ban, apt, etc.). Without this,
# Postfix routes them via MX of \${HELO_NAME} → loops back to itself → bounce
# every minute. /etc/aliases overrides system-mail destinations.
if ! grep -qE '^root:[[:space:]]*/dev/null' /etc/aliases 2>/dev/null; then
  echo 'root: /dev/null' >> /etc/aliases
  newaliases
fi

postmap /etc/postfix/byo/virtual_domains
postmap /etc/postfix/byo/virtual_aliases
postmap /etc/postfix/byo/virtual_mailboxes
postmap /etc/postfix/byo/sender_transport

# ── OpenDKIM ───────────────────────────────────────────────────────────────
[ -f /etc/opendkim.conf.aca-orig ] || cp -n /etc/opendkim.conf /etc/opendkim.conf.aca-orig 2>/dev/null || true

cat > /etc/opendkim.conf <<'EOF'
Syslog                  yes
SyslogSuccess           yes
LogWhy                  yes
UMask                   002
Mode                    sv
Canonicalization        relaxed/simple
SubDomains              no

KeyTable                refile:/etc/opendkim/key.table
SigningTable            refile:/etc/opendkim/signing.table
ExternalIgnoreList      refile:/etc/opendkim/trusted.hosts
InternalHosts           refile:/etc/opendkim/trusted.hosts

Socket                  inet:8891@localhost
PidFile                 /run/opendkim/opendkim.pid
UserID                  opendkim:opendkim
EOF

mkdir -p /run/opendkim
chown opendkim:opendkim /run/opendkim || true

# ── Dovecot ────────────────────────────────────────────────────────────────
[ -f /etc/dovecot/dovecot.conf.aca-orig ] || cp -n /etc/dovecot/dovecot.conf /etc/dovecot/dovecot.conf.aca-orig 2>/dev/null || true

cat > /etc/dovecot/conf.d/aca-byo.conf <<'EOF'
protocols = imap lmtp
listen = *

mail_location = maildir:/var/mail/vhosts/%d/%n
mail_privileged_group = vmail
mail_uid = vmail
mail_gid = vmail

passdb {
  driver = passwd-file
  args = scheme=SHA512-CRYPT username_format=%u /etc/dovecot/byo-passwd
}
userdb {
  driver = static
  args = uid=vmail gid=vmail home=/var/mail/vhosts/%d/%n
}

service auth {
  unix_listener /var/spool/postfix/private/auth {
    mode = 0660
    user = postfix
    group = postfix
  }
}

service lmtp {
  unix_listener /var/spool/postfix/private/dovecot-lmtp {
    mode = 0600
    user = postfix
    group = postfix
  }
}

ssl = required
ssl_cert = </etc/ssl/certs/ssl-cert-snakeoil.pem
ssl_key  = </etc/ssl/private/ssl-cert-snakeoil.key

disable_plaintext_auth = no
auth_mechanisms = plain login
EOF

touch /etc/dovecot/byo-passwd
chown root:dovecot /etc/dovecot/byo-passwd
chmod 640 /etc/dovecot/byo-passwd

systemctl restart opendkim
systemctl restart postfix
systemctl restart dovecot
systemctl status postfix opendkim dovecot --no-pager --lines=3 || true

echo "[configure-base] done — HELO=\${HELO_NAME}"
`;
