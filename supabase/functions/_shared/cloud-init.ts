/**
 * @deprecated — Legacy VM cloud-init generator. Replaced by ACS (acs-client.ts).
 * Kept only for reference; no longer used in new domain provisioning.
 *
 * Cloud-Init Script Generator
 *
 * Generates a cloud-init YAML script that configures an Ubuntu 22.04 VM as
 * a complete email sending server with Postfix, Dovecot, and OpenDKIM.
 * The script is base64-encoded for Azure VM customData.
 */

export interface CloudInitParams {
  domain: string;
  hostname: string;            // e.g. "mail.example.com"
  publicIp: string;
  dkimSelector: string;        // e.g. "aca1"
  adminUsername: string;        // VM admin user
}

/**
 * Generate a base64-encoded cloud-init script for email server setup.
 */
export function generateCloudInit(params: CloudInitParams): string {
  const { domain, hostname, publicIp, dkimSelector, adminUsername } = params;

  const script = `#cloud-config
package_update: true
package_upgrade: true

packages:
  - postfix
  - dovecot-imapd
  - dovecot-lmtpd
  - opendkim
  - opendkim-tools
  - nginx
  - certbot
  - python3-certbot-nginx
  - ufw
  - mailutils

write_files:
  # Postfix main.cf
  - path: /etc/postfix/main.cf
    content: |
      # ACA Email Infrastructure — managed by cloud-init
      smtpd_banner = ${hostname} ESMTP
      biff = no
      append_dot_mydomain = no
      readme_directory = no

      # TLS parameters (self-signed initially, certbot updates later)
      smtpd_tls_cert_file = /etc/ssl/certs/ssl-cert-snakeoil.pem
      smtpd_tls_key_file = /etc/ssl/private/ssl-cert-snakeoil.key
      smtpd_use_tls = yes
      smtpd_tls_auth_only = yes
      smtpd_tls_security_level = may
      smtp_tls_security_level = may
      smtpd_tls_protocols = !SSLv2, !SSLv3, !TLSv1, !TLSv1.1
      smtp_tls_protocols = !SSLv2, !SSLv3, !TLSv1, !TLSv1.1

      # SASL authentication
      smtpd_sasl_type = dovecot
      smtpd_sasl_path = private/auth
      smtpd_sasl_auth_enable = yes
      smtpd_sasl_security_options = noanonymous
      smtpd_sasl_local_domain = $myhostname

      # Restrictions
      smtpd_recipient_restrictions =
        permit_sasl_authenticated,
        reject_unauth_destination

      # Network
      myhostname = ${hostname}
      mydomain = ${domain}
      myorigin = $mydomain
      mydestination = $myhostname, ${domain}, localhost
      mynetworks = 127.0.0.0/8 [::ffff:127.0.0.0]/104 [::1]/128
      inet_interfaces = all
      inet_protocols = ipv4

      # Mailbox
      home_mailbox = Maildir/
      mailbox_size_limit = 52428800
      message_size_limit = 26214400

      # Virtual aliases (for forwarding/catch-all)
      virtual_alias_maps = hash:/etc/postfix/virtual

      # OpenDKIM
      milter_protocol = 6
      milter_default_action = accept
      smtpd_milters = inet:localhost:8891
      non_smtpd_milters = inet:localhost:8891

      # Rate limiting disabled — external tools (QuickMail) connect all mailboxes from one IP
      smtpd_client_message_rate_limit = 0
      smtpd_client_recipient_rate_limit = 0
      smtpd_client_connection_rate_limit = 0
      smtpd_client_connection_count_limit = 100
      anvil_rate_time_unit = 60s

      # Compatibility
      compatibility_level = 3.6
    owner: root:root
    permissions: '0644'

  # Postfix master.cf — enable submission port (587)
  - path: /etc/postfix/master.cf
    content: |
      # ==========================================================================
      # service type  private unpriv  chroot  wakeup  maxproc command + args
      # ==========================================================================
      smtp      inet  n       -       y       -       -       smtpd
      submission inet n       -       y       -       -       smtpd
        -o syslog_name=postfix/submission
        -o smtpd_tls_security_level=encrypt
        -o smtpd_sasl_auth_enable=yes
        -o smtpd_tls_auth_only=yes
        -o smtpd_reject_unlisted_recipient=no
        -o smtpd_recipient_restrictions=permit_sasl_authenticated,reject
        -o milter_macro_daemon_name=ORIGINATING
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
      postlog   unix-dgram n  -       n       -       1       postlogd
    owner: root:root
    permissions: '0644'

  # Empty virtual alias file (populated later via API)
  - path: /etc/postfix/virtual
    content: |
      # Virtual aliases — managed by ACA
      # Format: source@domain destination@example.com
    owner: root:root
    permissions: '0644'

  # Dovecot configuration
  - path: /etc/dovecot/conf.d/10-mail.conf
    content: |
      mail_location = maildir:~/Maildir
      namespace inbox {
        inbox = yes
      }
    owner: root:root
    permissions: '0644'

  - path: /etc/dovecot/conf.d/10-auth.conf
    content: |
      disable_plaintext_auth = yes
      auth_mechanisms = plain login
      !include auth-system.conf.ext
    owner: root:root
    permissions: '0644'

  - path: /etc/dovecot/conf.d/10-master.conf
    content: |
      service imap-login {
        inet_listener imap {
          port = 0
        }
        inet_listener imaps {
          port = 993
          ssl = yes
        }
      }
      service auth {
        unix_listener /var/spool/postfix/private/auth {
          mode = 0660
          user = postfix
          group = postfix
        }
      }
    owner: root:root
    permissions: '0644'

  - path: /etc/dovecot/conf.d/10-ssl.conf
    content: |
      ssl = required
      ssl_cert = </etc/ssl/certs/ssl-cert-snakeoil.pem
      ssl_key = </etc/ssl/private/ssl-cert-snakeoil.key
      ssl_min_protocol = TLSv1.2
    owner: root:root
    permissions: '0644'

  # Dovecot process limits — prevent connection exhaustion from monitoring tools
  - path: /etc/dovecot/conf.d/15-limits.conf
    content: |
      service imap-login {
        process_limit = 500
        service_count = 0
        process_min_avail = 5
        client_limit = 2
        vsz_limit = 128M
      }
    owner: root:root
    permissions: '0644'

  # OpenDKIM configuration
  - path: /etc/opendkim.conf
    content: |
      Syslog yes
      SyslogSuccess yes
      Mode sv
      Canonicalization relaxed/simple
      Domain ${domain}
      Selector ${dkimSelector}
      KeyFile /etc/opendkim/keys/${domain}/${dkimSelector}.private
      Socket inet:8891@localhost
      PidFile /run/opendkim/opendkim.pid
      OversignHeaders From
      TrustAnchorFile /usr/share/dns/root.key
      UserID opendkim
    owner: root:root
    permissions: '0644'

  # Nginx config for domain forwarding (default: return 301 to main domain)
  - path: /etc/nginx/sites-available/${domain}
    content: |
      server {
        listen 80;
        server_name ${domain} www.${domain};
        # Default: return 444 (no response) until forwarding is configured
        return 444;
      }
    owner: root:root
    permissions: '0644'

  # Nginx config for mail subdomain (needed for certbot)
  - path: /etc/nginx/sites-available/mail.${domain}
    content: |
      server {
        listen 80;
        server_name mail.${domain};
        location / {
          return 444;
        }
      }
    owner: root:root
    permissions: '0644'

  # MTA-STS policy server (serves /.well-known/mta-sts.txt)
  - path: /etc/nginx/sites-available/mta-sts.${domain}
    content: |
      server {
        listen 80;
        server_name mta-sts.${domain};
        location /.well-known/mta-sts.txt {
          return 200 "version: STSv1\\nmode: testing\\nmx: mail.${domain}\\nmax_age: 86400\\n";
          add_header Content-Type text/plain;
        }
        location / {
          return 444;
        }
      }
    owner: root:root
    permissions: '0644'

  # ACA management script (used by RunCommand API to manage mailboxes)
  - path: /usr/local/bin/aca-manage
    content: |
      #!/bin/bash
      # ACA Email Server Management Script
      # Called via Azure Run Command API

      set -e

      ACTION="$1"
      shift

      case "$ACTION" in
        create-mailbox)
          USERNAME="$1"
          PASSWORD="$2"
          DISPLAY_NAME="$3"
          # Create system user for mailbox
          useradd -m -s /usr/sbin/nologin -c "$DISPLAY_NAME" "$USERNAME" 2>/dev/null || true
          echo "$USERNAME:$PASSWORD" | chpasswd
          # Create Maildir
          mkdir -p "/home/$USERNAME/Maildir"
          chown -R "$USERNAME:$USERNAME" "/home/$USERNAME/Maildir"
          echo "OK: Mailbox $USERNAME created"
          ;;

        delete-mailbox)
          USERNAME="$1"
          userdel -r "$USERNAME" 2>/dev/null || true
          echo "OK: Mailbox $USERNAME deleted"
          ;;

        list-mailboxes)
          # List all non-system users with Maildir
          awk -F: '$3 >= 1000 && $3 < 65534 {print $1}' /etc/passwd
          ;;

        set-forwarding)
          EMAIL="$1"
          TARGET="$2"
          # Add or update forwarding in virtual aliases
          grep -v "^$EMAIL " /etc/postfix/virtual > /tmp/virtual.tmp || true
          echo "$EMAIL $TARGET" >> /tmp/virtual.tmp
          mv /tmp/virtual.tmp /etc/postfix/virtual
          postmap /etc/postfix/virtual
          postfix reload
          echo "OK: Forwarding $EMAIL -> $TARGET"
          ;;

        set-catchall)
          DOMAIN="$1"
          TARGET="$2"
          # Add or update catch-all
          grep -v "^@$DOMAIN " /etc/postfix/virtual > /tmp/virtual.tmp || true
          echo "@$DOMAIN $TARGET" >> /tmp/virtual.tmp
          mv /tmp/virtual.tmp /etc/postfix/virtual
          postmap /etc/postfix/virtual
          postfix reload
          echo "OK: Catch-all @$DOMAIN -> $TARGET"
          ;;

        remove-catchall)
          DOMAIN="$1"
          grep -v "^@$DOMAIN " /etc/postfix/virtual > /tmp/virtual.tmp || true
          mv /tmp/virtual.tmp /etc/postfix/virtual
          postmap /etc/postfix/virtual
          postfix reload
          echo "OK: Catch-all removed for @$DOMAIN"
          ;;

        set-domain-forward)
          URL="$1"
          cat > /etc/nginx/sites-available/${domain} <<NGINX
      server {
        listen 80;
        server_name ${domain} www.${domain};
        return 301 $URL\\$request_uri;
      }
      NGINX
          nginx -s reload
          echo "OK: Domain forwarding to $URL"
          ;;

        update-hostname)
          NEW_HOSTNAME="$1"
          NEW_IP="$2"
          # Update Postfix hostname
          postconf -e "myhostname=$NEW_HOSTNAME"
          postfix reload
          echo "OK: Hostname updated to $NEW_HOSTNAME"
          ;;

        get-dkim-public-key)
          cat /etc/opendkim/keys/${domain}/${dkimSelector}.txt 2>/dev/null || echo "ERROR: DKIM key not found"
          ;;

        health-check)
          echo "postfix: $(systemctl is-active postfix)"
          echo "dovecot: $(systemctl is-active dovecot)"
          echo "opendkim: $(systemctl is-active opendkim)"
          echo "nginx: $(systemctl is-active nginx)"
          echo "smtp-port: $(ss -tlnp | grep ':587' | wc -l)"
          echo "imap-port: $(ss -tlnp | grep ':993' | wc -l)"
          ;;

        setup-tls)
          DOMAIN="$1"
          certbot --nginx -d "mail.$DOMAIN" -d "mta-sts.$DOMAIN" \
            --non-interactive --agree-tos --email "admin@$DOMAIN" \
            --redirect 2>&1 || echo "CERTBOT_FAILED"
          if [ -f "/etc/letsencrypt/live/mail.$DOMAIN/fullchain.pem" ]; then
            postconf -e "smtpd_tls_cert_file=/etc/letsencrypt/live/mail.$DOMAIN/fullchain.pem"
            postconf -e "smtpd_tls_key_file=/etc/letsencrypt/live/mail.$DOMAIN/privkey.pem"
            postfix reload
            cat > /etc/dovecot/conf.d/10-ssl.conf <<'DOVECOT'
ssl = required
ssl_cert = </etc/letsencrypt/live/mail.DOMAIN_PLACEHOLDER/fullchain.pem
ssl_key = </etc/letsencrypt/live/mail.DOMAIN_PLACEHOLDER/privkey.pem
ssl_min_protocol = TLSv1.2
DOVECOT
            sed -i "s/DOMAIN_PLACEHOLDER/$DOMAIN/g" /etc/dovecot/conf.d/10-ssl.conf
            systemctl restart dovecot
            echo "OK: TLS configured with Let's Encrypt for mail.$DOMAIN"
          else
            echo "ERROR: Certbot failed - certs not found"
          fi
          ;;

        upgrade-mta-sts-mode)
          MODE="$1"
          DOMAIN="$2"
          cat > /etc/nginx/sites-available/mta-sts.$DOMAIN <<NGINX
      server {
        listen 80;
        server_name mta-sts.$DOMAIN;
        location /.well-known/mta-sts.txt {
          return 200 "version: STSv1\\nmode: $MODE\\nmx: mail.$DOMAIN\\nmax_age: 86400\\n";
          add_header Content-Type text/plain;
        }
        location / {
          return 444;
        }
      }
      NGINX
          nginx -s reload
          echo "OK: MTA-STS mode set to $MODE"
          ;;

        *)
          echo "ERROR: Unknown action $ACTION"
          echo "Usage: aca-manage {create-mailbox|delete-mailbox|list-mailboxes|set-forwarding|set-catchall|remove-catchall|set-domain-forward|update-hostname|get-dkim-public-key|health-check|setup-tls|upgrade-mta-sts-mode}"
          exit 1
          ;;
      esac
    owner: root:root
    permissions: '0755'

runcmd:
  # Generate DKIM keys
  - mkdir -p /etc/opendkim/keys/${domain}
  - opendkim-genkey -b 2048 -d ${domain} -D /etc/opendkim/keys/${domain} -s ${dkimSelector} -v
  - chown -R opendkim:opendkim /etc/opendkim/keys
  - chmod 600 /etc/opendkim/keys/${domain}/${dkimSelector}.private

  # Build virtual alias database
  - postmap /etc/postfix/virtual

  # Enable and configure Nginx
  - ln -sf /etc/nginx/sites-available/${domain} /etc/nginx/sites-enabled/${domain}
  - ln -sf /etc/nginx/sites-available/mail.${domain} /etc/nginx/sites-enabled/mail.${domain}
  - ln -sf /etc/nginx/sites-available/mta-sts.${domain} /etc/nginx/sites-enabled/mta-sts.${domain}
  - rm -f /etc/nginx/sites-enabled/default

  # Configure firewall
  - ufw default deny incoming
  - ufw default allow outgoing
  - ufw allow 22/tcp
  - ufw allow 25/tcp
  - ufw allow 587/tcp
  - ufw allow 993/tcp
  - ufw allow 80/tcp
  - ufw allow 443/tcp
  - ufw --force enable

  # Restart all services
  - systemctl enable postfix dovecot opendkim nginx
  - systemctl restart opendkim
  - systemctl restart postfix
  - systemctl restart dovecot
  - systemctl restart nginx

  # Certbot auto-renewal cron (runs twice daily)
  - echo "0 3,15 * * * root certbot renew --quiet --post-hook 'systemctl reload postfix dovecot nginx'" > /etc/cron.d/certbot-renew
  - chmod 644 /etc/cron.d/certbot-renew

  # Auto-TLS setup: retry certbot every 5 min for 1 hour (waits for DNS propagation)
  - |
    cat > /usr/local/bin/aca-auto-tls <<'SCRIPT'
    #!/bin/bash
    DOMAIN="${domain}"
    LOG="/var/log/aca-auto-tls.log"
    for i in $(seq 1 12); do
      echo "[$(date)] Attempt $i: checking DNS for mail.$DOMAIN..." >> $LOG
      # Check if mail.<domain> resolves to our IP before running certbot
      RESOLVED=$(dig +short mail.$DOMAIN A 2>/dev/null | head -1)
      MY_IP=$(curl -s -4 ifconfig.me 2>/dev/null || echo "unknown")
      if [ "$RESOLVED" = "$MY_IP" ] && [ -n "$MY_IP" ]; then
        echo "[$(date)] DNS resolved (mail.$DOMAIN -> $RESOLVED), running certbot..." >> $LOG
        /usr/local/bin/aca-manage setup-tls "$DOMAIN" >> $LOG 2>&1
        if [ -f "/etc/letsencrypt/live/mail.$DOMAIN/fullchain.pem" ]; then
          echo "[$(date)] TLS setup successful!" >> $LOG
          exit 0
        fi
      else
        echo "[$(date)] DNS not ready (got: $RESOLVED, expected: $MY_IP), waiting..." >> $LOG
      fi
      sleep 300
    done
    echo "[$(date)] Auto-TLS gave up after 12 attempts. Run 'aca-manage setup-tls $DOMAIN' manually after DNS is configured." >> $LOG
    SCRIPT
    chmod +x /usr/local/bin/aca-auto-tls
  - nohup /usr/local/bin/aca-auto-tls &

  # Signal that setup is complete
  - touch /var/log/aca-setup-complete
  - echo "ACA email server setup complete for ${domain}" >> /var/log/cloud-init-output.log
`;

  // Base64 encode for Azure VM customData
  const encoder = new TextEncoder();
  const bytes = encoder.encode(script);
  return btoa(String.fromCharCode(...bytes));
}
