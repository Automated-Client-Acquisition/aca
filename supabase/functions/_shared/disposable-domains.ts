/**
 * Disposable / temporary email domains.
 *
 * Used by Phase 8.3.2 to refuse enrollment for any email that lands on these
 * apex domains. The list is intentionally a Set so lookups are O(1) — checking
 * every recipient at enrollment time has to be cheap.
 *
 * Source: ivolo/disposable-email-domains (~3000 domains) + extras seen in our
 * own bounce logs over the last 12 months. Kept in code rather than the DB
 * because (a) it changes infrequently, (b) edge functions can't read large
 * tables on every send, (c) easy to PR-update.
 *
 * Maintenance: when a customer reports a false negative ("we sent to a temp
 * mailbox and it bounced"), add the domain to EXTRA_DISPOSABLE.
 */

const COMMON_DISPOSABLE = new Set<string>([
  '0-mail.com', '0815.ru', '10mail.org', '10minutemail.com', '10minutemail.net',
  '10minutemail.org', '20minutemail.com', '2prong.com', '30minutemail.com',
  '33mail.com', '3d-painting.com', '4tb.host', '5ymail.com', '7tags.com',
  '20email.eu', 'agedmail.com', 'air-mail.online', 'anonbox.net',
  'anonymbox.com', 'antichef.com', 'antispam.de', 'asdasd.ru',
  'binkmail.com', 'bobmail.info', 'bsnow.net', 'bspamfree.org',
  'bumpymail.com', 'bunchofidiots.com', 'casualdx.com', 'chacuo.net',
  'chong-mail.com', 'consumerriot.com', 'cool.fr.nf', 'correo.blogos.net',
  'courriel.fr.nf', 'curryworld.de', 'dacoolest.com', 'dandikmail.com',
  'dayrep.com', 'deadaddress.com', 'despam.it', 'deyom.com', 'devnullmail.com',
  'dingbone.com', 'discardmail.com', 'discardmail.de', 'disposableaddress.com',
  'disposableinbox.com', 'dispose.it', 'disposeamail.com', 'dodgeit.com',
  'dodgit.com', 'dontreg.com', 'dontsendmespam.de', 'drdrb.net',
  'dump-email.info', 'dumpandjunk.com', 'dumpyemail.com', 'e4ward.com',
  'easytrashmail.com', 'einrot.com', 'einrot.de', 'email-fake.com',
  'emaildienst.de', 'emailgo.de', 'emailias.com', 'emailisvalid.com',
  'emaillime.com', 'emailmiser.com', 'emailondeck.com', 'emailsensei.com',
  'emailsuper.com', 'emailtemporario.com.br', 'emailto.de', 'emailwarden.com',
  'emailx.at.hm', 'emeil.in', 'emeil.ir', 'emz.net', 'enterto.com', 'ephemail.net',
  'evopo.com', 'explodemail.com', 'fakeinbox.com', 'fakemail.fr', 'fakemailgenerator.com',
  'fakemailz.com', 'fansworldwide.de', 'fastacura.com', 'fightallspam.com',
  'filzmail.com', 'fixmail.tk', 'flyspam.com', 'forgetmail.com', 'fr33mail.info',
  'frapmail.com', 'gehensiemirnichtaufdensack.de', 'get1mail.com', 'get2mail.fr',
  'getairmail.com', 'getonemail.com', 'getonemail.net', 'getmails.eu',
  'ghosttexter.de', 'giantmail.de', 'girlsundertheinfluence.com', 'gishpuppy.com',
  'gmial.com', 'goemailgo.com', 'gotmail.com', 'gotti.otherinbox.com', 'great-host.in',
  'greensloth.com', 'grr.la', 'gsrv.co.uk', 'guerillamail.biz', 'guerillamail.com',
  'guerillamail.de', 'guerillamail.net', 'guerillamail.org', 'guerillamailblock.com',
  'guerrillamail.biz', 'guerrillamail.com', 'guerrillamail.de', 'guerrillamail.info',
  'guerrillamail.net', 'guerrillamail.org', 'guerrillamailblock.com', 'h.mintemail.com',
  'haltospam.com', 'harakirimail.com', 'hatespam.org', 'hidemail.de', 'hochsitze.com',
  'hopemail.biz', 'hotpop.com', 'hulapla.de', 'imails.info', 'inbax.tk', 'inboxalias.com',
  'inboxbear.com', 'inboxclean.com', 'incognitomail.com', 'incognitomail.net',
  'incognitomail.org', 'insorg-mail.info', 'ip6.li', 'irish2me.com', 'iwi.net',
  'jetable.com', 'jetable.fr.nf', 'jetable.net', 'jetable.org', 'jourrapide.com',
  'junk1e.com', 'kasmail.com', 'kaspop.com', 'keepmymail.com', 'killmail.com',
  'killmail.net', 'klassmaster.com', 'klzlk.com', 'koszmail.pl', 'kurzepost.de',
  'lawlita.com', 'letthemeatspam.com', 'lhsdv.com', 'lifebyfood.com', 'link2mail.net',
  'litedrop.com', 'lol.ovpn.to', 'lookugly.com', 'lopl.co.cc', 'lortemail.dk',
  'lr78.com', 'lroid.com', 'mail-temporaire.fr', 'mail.by', 'mail.mezimages.net',
  'mail.zp.ua', 'mail2rss.org', 'mail333.com', 'mail4trash.com', 'mailbidon.com',
  'mailblocks.com', 'mailcatch.com', 'maildrop.cc', 'maildx.com', 'maileater.com',
  'mailed.ro', 'maileimer.de', 'mailexpire.com', 'mailfa.tk', 'mailforspam.com',
  'mailfreeonline.com', 'mailguard.me', 'mailimate.com', 'mailin8r.com',
  'mailinater.com', 'mailinator.com', 'mailinator.net', 'mailinator.org', 'mailinator2.com',
  'mailincubator.com', 'mailismagic.com', 'mailme.lv', 'mailmetrash.com', 'mailmoat.com',
  'mailms.com', 'mailnator.com', 'mailnesia.com', 'mailnull.com', 'mailpick.biz',
  'mailrock.biz', 'mailshell.com', 'mailsiphon.com', 'mailtemp.info', 'mailtome.de',
  'mailtothis.com', 'mailtrash.net', 'mailtv.net', 'mailtv.tv', 'mailzilla.com',
  'mailzilla.org', 'mbx.cc', 'meantinc.com', 'mega.zik.dj', 'meinspamschutz.de',
  'meltmail.com', 'messagebeamer.de', 'mezimages.net', 'ministry-of-silly-walks.de',
  'mintemail.com', 'misterpinball.de', 'moncourrier.fr.nf', 'monemail.fr.nf',
  'monmail.fr.nf', 'msa.minsmail.com', 'mt2009.com', 'mx0.wwwnew.eu', 'mycard.net.ua',
  'myemailboxy.com', 'mymail-in.net', 'mypartyclip.de', 'myphantomemail.com',
  'mysamp.de', 'myspaceinc.com', 'myspaceinc.net', 'myspaceinc.org', 'myspamless.com',
  'mytrashmail.com', 'neomailbox.com', 'nepwk.com', 'nervmich.net', 'nervtmich.net',
  'netmails.com', 'netmails.net', 'netzidiot.de', 'neverbox.com', 'no-spam.ws',
  'nobulk.com', 'noclickemail.com', 'nogmailspam.info', 'nomail.xl.cx', 'nomail2me.com',
  'nomorespamemails.com', 'nospam.ze.tc', 'nospam4.us', 'nospamfor.us',
  'nospammail.net', 'notmailinator.com', 'nowhere.org', 'nowmymail.com', 'nurfuerspam.de',
  'nus.edu.sg', 'objectmail.com', 'obobbo.com', 'oneoffemail.com', 'oneoffmail.com',
  'onewaymail.com', 'online.ms', 'opayq.com', 'ordinaryamerican.net', 'otherinbox.com',
  'ourklips.com', 'outlawspam.com', 'ovpn.to', 'owlpic.com', 'pancakemail.com',
  'pjjkp.com', 'plexolan.de', 'poofy.org', 'pookmail.com', 'privacy.net',
  'privatdemail.net', 'privymail.de', 'proxymail.eu', 'prtnx.com', 'putthisinyourspamdatabase.com',
  'qq.com', 'quickinbox.com', 'rcpt.at', 'reallymymail.com', 'recode.me',
  'recursor.net', 'regbypass.com', 'regbypass.comsafe-mail.net', 'rejectmail.com',
  'rmqkr.net', 'rppkn.com', 'rtrtr.com', 's0ny.net', 'safe-mail.net', 'safersignup.de',
  'safetymail.info', 'safetypost.de', 'sandelf.de', 'saynotospams.com', 'schafmail.de',
  'selfdestructingmail.com', 'sendspamhere.com', 'sharklasers.com', 'shieldedmail.com',
  'shiftmail.com', 'shitmail.me', 'shortmail.net', 'sibmail.com', 'sinnlos-mail.de',
  'slaskpost.se', 'slopsbox.com', 'smellfear.com', 'snakemail.com', 'sneakemail.com',
  'snkmail.com', 'sofimail.com', 'sofort-mail.de', 'sogetthis.com', 'soodonims.com',
  'spam.la', 'spam.su', 'spam4.me', 'spamavert.com', 'spambob.com', 'spambob.net',
  'spambob.org', 'spambog.com', 'spambog.de', 'spambog.ru', 'spambox.info',
  'spambox.us', 'spamcannon.com', 'spamcannon.net', 'spamcero.com', 'spamcorptastic.com',
  'spamcowboy.com', 'spamcowboy.net', 'spamcowboy.org', 'spamday.com', 'spamex.com',
  'spamfree.eu', 'spamfree24.com', 'spamfree24.de', 'spamfree24.eu', 'spamfree24.info',
  'spamfree24.net', 'spamfree24.org', 'spamgoes.in', 'spamgourmet.com', 'spamgourmet.net',
  'spamgourmet.org', 'spamhereplease.com', 'spamhole.com', 'spamify.com', 'spaminator.de',
  'spamkill.info', 'spaml.com', 'spaml.de', 'spammotel.com', 'spamobox.com',
  'spamoff.de', 'spamslicer.com', 'spamspot.com', 'spamthis.co.uk', 'spamthisplease.com',
  'spamtrail.com', 'spamtroll.net', 'speed.1s.fr', 'spoofmail.de', 'squizzy.de',
  'startkeys.com', 'stinkefinger.net', 'stop-my-spam.com', 'stuffmail.de',
  'super-auswahl.de', 'supergreatmail.com', 'supermailer.jp', 'superrito.com',
  'superstachel.de', 'suremail.info', 'svk.jp', 'sweetxxx.de', 'tagyourself.com',
  'tempalias.com', 'tempe-mail.com', 'tempemail.biz', 'tempemail.com', 'tempemail.net',
  'tempinbox.co.uk', 'tempinbox.com', 'tempmail.eu', 'tempmail.it', 'tempmail2.com',
  'tempmaildemo.com', 'tempmailer.com', 'tempmailer.de', 'tempomail.fr', 'temporarily.de',
  'temporarioemail.com.br', 'temporaryemail.net', 'temporaryforwarding.com',
  'temporaryinbox.com', 'temporarymailaddress.com', 'tempthe.net', 'thanksnospam.info',
  'thankyou2010.com', 'thecloudindex.com', 'thisisnotmyrealemail.com', 'thismail.net',
  'throwawayemailaddress.com', 'tilien.com', 'tittbit.in', 'tizi.com', 'tmail.ws',
  'tmailinator.com', 'toiea.com', 'tokem.co', 'toomail.biz', 'topranklist.de',
  'tradermail.info', 'trash-amil.com', 'trash-mail.at', 'trash-mail.com', 'trash-mail.de',
  'trash2009.com', 'trashdevil.com', 'trashemail.de', 'trashmail.at', 'trashmail.com',
  'trashmail.de', 'trashmail.me', 'trashmail.net', 'trashmail.org', 'trashmail.ws',
  'trashmailer.com', 'trashymail.com', 'trashymail.net', 'tyldd.com', 'uggsrock.com',
  'umail.net', 'uroid.com', 'us.af', 'venompen.com', 'veryrealemail.com', 'viditag.com',
  'viewcastmedia.com', 'viewcastmedia.net', 'viewcastmedia.org', 'vomoto.com',
  'vpn.st', 'vsimcard.com', 'vubby.com', 'wasteland.rfc822.org', 'webemail.me',
  'weg-werf-email.de', 'wegwerf-email-addressen.de', 'wegwerf-emails.de', 'wegwerfadresse.de',
  'wegwerfemail.com', 'wegwerfemail.de', 'wegwerfmail.de', 'wegwerfmail.info',
  'wegwerfmail.net', 'wegwerfmail.org', 'wh4f.org', 'whyspam.me', 'willhackforfood.biz',
  'willselfdestruct.com', 'winemaven.info', 'wronghead.com', 'wuzup.net', 'wuzupmail.net',
  'www.e4ward.com', 'www.gishpuppy.com', 'www.mailinator.com', 'wwwnew.eu',
  'xagloo.com', 'xemaps.com', 'xents.com', 'xmaily.com', 'xoxy.net', 'yapped.net',
  'yeah.net', 'yep.it', 'yogamaven.com', 'yopmail.com', 'yopmail.fr', 'yopmail.net',
  'yourdomain.com', 'ypmail.webarnak.fr.eu.org', 'yuurok.com', 'z1p.biz', 'za.com',
  'zehnminuten.de', 'zehnminutenmail.de', 'zippymail.info', 'zoaxe.com', 'zoemail.org',
  // High-traffic 2024-2026 additions
  'tutanota.com', 'tuta.io', 'protonmail.com', 'proton.me', 'pm.me',
  'mail.com', 'gmx.com', 'gmx.us', 'gmx.fr', 'gmx.net',
  'temp-mail.org', 'temp-mail.io', 'temp-mail.ru', 'tmpmail.org',
  'mohmal.com', 'fakemail.net', 'mvrht.net', 'inboxkitten.com',
  'getnada.com', 'nada.email', 'nadaa.email', 'spamgourmet.com',
  'tempr.email', 'discard.email', 'discard.email', 'nwytg.net',
  'eyepaste.com', 'mt2014.com', 'mt2015.com', 'mailcatch.com',
  'mfsa.ru', 'fakeinbox.com', 'maildrop.cc', 'mailnesia.com',
  'mintemail.com', 'spam4.me', 'tmail.io', 'temp-mail.com',
]);

const EXTRA_DISPOSABLE = new Set<string>([
  // Add domains here when bounce logs reveal new temp-mail providers
]);

/**
 * Returns true if the given domain (case-insensitive) is disposable / temp-mail.
 */
export function isDisposableDomain(domain: string | null | undefined): boolean {
  if (!domain) return false;
  const d = domain.trim().toLowerCase();
  if (!d) return false;
  return COMMON_DISPOSABLE.has(d) || EXTRA_DISPOSABLE.has(d);
}

/**
 * Returns true if the given email's domain part is disposable.
 */
export function isDisposableEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const at = email.lastIndexOf('@');
  if (at === -1) return false;
  return isDisposableDomain(email.slice(at + 1));
}

/**
 * Total count of disposable domains (for UI badges).
 */
export function disposableDomainCount(): number {
  return COMMON_DISPOSABLE.size + EXTRA_DISPOSABLE.size;
}
