# Acceptable use

ACA sends email and messages to people who did not ask to hear from you. That only works, for you
and for everyone sharing the same mail providers, when the sending is honest, relevant and easy to
stop. This policy sets the rules.

## Who it covers

- **ACA Cloud**, the hosted app, and **ACA's network services** (Microsoft 365 tenants, the warmup
  network and the lead pool, including through `/v1/network`). Breaking this policy ends your access
  to them.
- **Self-hosted ACA.** The software is yours to run under the [license](LICENSE.md). We can't police
  your server, but these rules describe the only way we support using ACA, and the network services
  require them.

## Sending rules

1. **Honour every opt-out, at once and for good.** Keep the unsubscribe link and the
   `List-Unsubscribe` header on for cold outreach. Never re-add someone who unsubscribed, asked to
   stop, or bounced, whether on a new list, a new domain or a new mailbox.
2. **Say who you are.** A real sender name, a real business, and the postal address the law in your
   recipients' country requires (CAN-SPAM does for the US).
3. **No deception.** Subject lines, sender names and headers must match what the email is. No fake
   "Re:" or "Fwd:" threads, no pretending to be someone else.
4. **Business relevance.** Write to people about their work, for a reason that fits their role.
   Under the UK's PECR and EU rules, marketing email to individuals, including sole traders and
   personal addresses, generally needs prior consent. Corporate addresses can be contacted with an
   opt-out, as long as the person's data is handled under a lawful basis (GDPR legitimate interest,
   with a record of your assessment).
5. **Stop when people answer.** A reply ends the sequence for that person unless they asked to keep
   hearing from you.
6. **Treat bounces as final.** A hard bounce suppresses the address everywhere.
7. **Follow the rules of every platform you connect.** LinkedIn, WhatsApp, Instagram and the rest
   have their own limits and terms. Staying within them is your responsibility.
8. **Look after the data.** You are the controller of the contacts you import, enrich or collect.
   Answer access and deletion requests, and don't keep data you no longer need.

## Never use ACA to

- send phishing, malware, or links that harvest credentials or payment details;
- impersonate a person, brand or organisation, or send on someone's behalf without their permission;
- promote anything illegal where you or your recipients are, or run scams and fraud;
- harass, threaten or abuse anyone, or target people for who they are;
- keep mailing people who opted out, or a provider that blocked you, by switching domains, mailboxes
  or accounts;
- resell or share access to the network services, or use them for anyone other than your own
  organisation and the clients you are allowed to act for.

## Guards that are on by default

ACA ships with these switched on. Leave them on unless the law and the situation clearly allow
otherwise (for example, a one-to-one reply in a conversation the person started).

| Guard | What it does |
|---|---|
| Unsubscribe link | Added to every sequence email. The link shows a confirmation page, so mail scanners that open links can't unsubscribe people by accident |
| One-click unsubscribe header | `List-Unsubscribe` and `List-Unsubscribe-Post` (RFC 8058) on every sequence email |
| Suppression | Contacts marked unsubscribed, do-not-contact or bounced are skipped when enrolling and again at send time |
| Hard-bounce suppression | A hard bounce marks the contact as bounced across every sequence |
| Stop on reply | A genuine reply stops every active sequence for that person; out-of-office replies only pause |

Self-hosted installs must serve their own unsubscribe links: run the tracking proxy and set
`UNSUBSCRIBE_FALLBACK_HOST` to its host. The sequence sender refuses to start in a self-hosted
install without it, so opt-outs can't end up somewhere they are never read.

## Reporting abuse

Write to support@automatedclientacquisition.com with the email, including its full headers. We
answer every report and act on ACA Cloud and the network services.

This policy is not legal advice. The law depends on where you and your recipients are. When in
doubt, ask a lawyer before you send.
