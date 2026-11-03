/**
 * ACA List Building Engine — SMTP Verifier
 *
 * Minimal RFC-5321 conversation against the target MX to probe RCPT TO
 * without actually delivering mail. Uses raw Deno.connect sockets so we can
 * later route through SOCKS/HTTP proxies per org. Catch-all detection is a
 * second RCPT TO with a random local-part — if both 250, the domain accepts
 * anything and verification signal is useless.
 *
 * Spec: ACA_List_Building_Engine_Spec v1.0, section 6.
 */

import type { VerificationResult, VerificationStatus } from './types.ts';

const DEFAULT_TIMEOUT_MS = 10_000;
const HELO_NAME = 'aca-verify.local';
const MAIL_FROM = '<verify@aca-verify.local>';

export interface ProxyTunnelConfig {
  type: 'socks5' | 'http_connect';
  host: string;
  port: number;
  username?: string;
  password?: string;
}

export interface VerifyOptions {
  mxHosts?: string[];
  timeoutMs?: number;
  catchAllProbe?: boolean;
  heloName?: string;
  mailFrom?: string;
  proxyId?: string;
  proxy?: ProxyTunnelConfig;
}

// ----------------------------------------------------------------------------
// Proxy tunneling (SOCKS5 / HTTP CONNECT)
// ----------------------------------------------------------------------------

async function readExactly(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  leftover: { buf: Uint8Array },
  n: number,
): Promise<Uint8Array> {
  while (leftover.buf.length < n) {
    const { value, done } = await reader.read();
    if (done) throw new Error('proxy: connection closed');
    const merged = new Uint8Array(leftover.buf.length + value.length);
    merged.set(leftover.buf, 0);
    merged.set(value, leftover.buf.length);
    leftover.buf = merged;
  }
  const out = leftover.buf.slice(0, n);
  leftover.buf = leftover.buf.slice(n);
  return out;
}

async function socks5Handshake(
  conn: Deno.Conn,
  proxy: ProxyTunnelConfig,
  targetHost: string,
  targetPort: number,
): Promise<void> {
  const reader = conn.readable.getReader();
  const writer = conn.writable.getWriter();
  const leftover = { buf: new Uint8Array(0) };
  try {
    // Greeting: VER=5, NMETHODS=2, METHODS=[NO_AUTH(0x00), USER_PASS(0x02)]
    await writer.write(new Uint8Array([0x05, 0x02, 0x00, 0x02]));
    const greet = await readExactly(reader, leftover, 2);
    if (greet[0] !== 0x05) throw new Error('socks5: bad version');
    const method = greet[1];
    if (method === 0xff) throw new Error('socks5: no acceptable auth');
    if (method === 0x02) {
      const user = proxy.username ?? '';
      const pass = proxy.password ?? '';
      const uBytes = new TextEncoder().encode(user);
      const pBytes = new TextEncoder().encode(pass);
      const authReq = new Uint8Array(3 + uBytes.length + pBytes.length);
      authReq[0] = 0x01;
      authReq[1] = uBytes.length;
      authReq.set(uBytes, 2);
      authReq[2 + uBytes.length] = pBytes.length;
      authReq.set(pBytes, 3 + uBytes.length);
      await writer.write(authReq);
      const authResp = await readExactly(reader, leftover, 2);
      if (authResp[0] !== 0x01 || authResp[1] !== 0x00) {
        throw new Error('socks5: auth failed');
      }
    } else if (method !== 0x00) {
      throw new Error(`socks5: unsupported method 0x${method.toString(16)}`);
    }

    // CONNECT request: VER=5 CMD=1 RSV=0 ATYP=3 (domain)
    const hostBytes = new TextEncoder().encode(targetHost);
    if (hostBytes.length > 255) throw new Error('socks5: host too long');
    const req = new Uint8Array(4 + 1 + hostBytes.length + 2);
    req[0] = 0x05;
    req[1] = 0x01;
    req[2] = 0x00;
    req[3] = 0x03;
    req[4] = hostBytes.length;
    req.set(hostBytes, 5);
    req[5 + hostBytes.length] = (targetPort >> 8) & 0xff;
    req[6 + hostBytes.length] = targetPort & 0xff;
    await writer.write(req);

    // Reply: VER REP RSV ATYP BND.ADDR BND.PORT
    const head = await readExactly(reader, leftover, 4);
    if (head[0] !== 0x05) throw new Error('socks5: bad reply version');
    if (head[1] !== 0x00) throw new Error(`socks5: connect failed rep=0x${head[1].toString(16)}`);
    const atyp = head[3];
    let addrLen = 0;
    if (atyp === 0x01) addrLen = 4;
    else if (atyp === 0x04) addrLen = 16;
    else if (atyp === 0x03) {
      const ln = await readExactly(reader, leftover, 1);
      addrLen = ln[0];
    } else throw new Error(`socks5: bad ATYP 0x${atyp.toString(16)}`);
    await readExactly(reader, leftover, addrLen + 2);

    if (leftover.buf.length > 0) {
      // Extremely rare: proxy sent server banner bytes piggybacked on the
      // reply. Not expected for SMTP which is server-initiated; abort to keep
      // the downstream parser simple.
      throw new Error('socks5: unexpected piggybacked bytes');
    }
  } finally {
    reader.releaseLock();
    writer.releaseLock();
  }
}

async function httpConnectHandshake(
  conn: Deno.Conn,
  proxy: ProxyTunnelConfig,
  targetHost: string,
  targetPort: number,
): Promise<void> {
  const reader = conn.readable.getReader();
  const writer = conn.writable.getWriter();
  try {
    const target = `${targetHost}:${targetPort}`;
    const lines = [
      `CONNECT ${target} HTTP/1.1`,
      `Host: ${target}`,
    ];
    if (proxy.username || proxy.password) {
      const creds = `${proxy.username ?? ''}:${proxy.password ?? ''}`;
      const b64 = btoa(creds);
      lines.push(`Proxy-Authorization: Basic ${b64}`);
    }
    lines.push('', '');
    await writer.write(new TextEncoder().encode(lines.join('\r\n')));

    // Read until \r\n\r\n.
    const decoder = new TextDecoder();
    let buf = '';
    while (!buf.includes('\r\n\r\n')) {
      const { value, done } = await reader.read();
      if (done) throw new Error('http_connect: connection closed');
      buf += decoder.decode(value, { stream: true });
      if (buf.length > 8192) throw new Error('http_connect: header too large');
    }
    const statusLine = buf.split('\r\n', 1)[0];
    const m = statusLine.match(/^HTTP\/\d\.\d\s+(\d{3})/);
    if (!m) throw new Error(`http_connect: bad status line: ${statusLine}`);
    const code = parseInt(m[1], 10);
    if (code !== 200) throw new Error(`http_connect: proxy returned ${code}`);

    const headerEnd = buf.indexOf('\r\n\r\n') + 4;
    if (headerEnd < buf.length) {
      throw new Error('http_connect: unexpected piggybacked bytes');
    }
  } finally {
    reader.releaseLock();
    writer.releaseLock();
  }
}

async function connectViaProxy(
  proxy: ProxyTunnelConfig,
  targetHost: string,
  targetPort: number,
): Promise<Deno.Conn> {
  const conn = await Deno.connect({ hostname: proxy.host, port: proxy.port });
  try {
    if (proxy.type === 'socks5') {
      await socks5Handshake(conn, proxy, targetHost, targetPort);
    } else if (proxy.type === 'http_connect') {
      await httpConnectHandshake(conn, proxy, targetHost, targetPort);
    } else {
      throw new Error(`unknown proxy type: ${(proxy as { type: string }).type}`);
    }
    return conn;
  } catch (err) {
    try { conn.close(); } catch { /* ignore */ }
    throw err;
  }
}

// ----------------------------------------------------------------------------
// Socket conversation helpers
// ----------------------------------------------------------------------------

interface ParsedReply {
  code: number;
  lines: string[];
}

async function readReply(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  buffer: { pending: string },
  signal: AbortSignal
): Promise<ParsedReply> {
  const decoder = new TextDecoder();
  // Read until we have a line whose 4th char is ' ' (final line marker).
  while (true) {
    if (signal.aborted) throw new Error('timeout');
    const lines = buffer.pending.split('\r\n');
    // Keep the last partial line in the buffer
    buffer.pending = lines.pop() ?? '';
    const collected: string[] = [];
    let code = 0;
    let terminal = false;
    for (const l of lines) {
      if (!l) continue;
      collected.push(l);
      if (l.length >= 4 && l[3] === ' ') {
        code = parseInt(l.slice(0, 3), 10);
        terminal = true;
      }
    }
    if (terminal && collected.length > 0) {
      // Push any lines we didn't consume back (we consumed all)
      return { code, lines: collected };
    }
    // Need more bytes
    const { value, done } = await reader.read();
    if (done) throw new Error('connection closed');
    buffer.pending = (collected.join('\r\n') + (collected.length ? '\r\n' : '')) + buffer.pending + decoder.decode(value);
  }
}

async function writeLine(
  writer: WritableStreamDefaultWriter<Uint8Array>,
  line: string
): Promise<void> {
  await writer.write(new TextEncoder().encode(line + '\r\n'));
}

// ----------------------------------------------------------------------------
// Core verification
// ----------------------------------------------------------------------------

async function verifyAgainstHost(
  mxHost: string,
  email: string,
  opts: Required<Pick<VerifyOptions, 'timeoutMs' | 'catchAllProbe' | 'heloName' | 'mailFrom'>> & { proxyId?: string; proxy?: ProxyTunnelConfig }
): Promise<VerificationResult> {
  const result: VerificationResult = {
    email,
    status: 'failed',
    smtp_response_code: null,
    catch_all: false,
    proxy_id: opts.proxyId ?? null,
    attempts: 1,
  };

  const ports = [25, 587];
  const signal = AbortSignal.timeout(opts.timeoutMs);
  let conn: Deno.Conn | null = null;
  let lastErr: string | undefined;

  for (const port of ports) {
    try {
      if (opts.proxy) {
        conn = await connectViaProxy(opts.proxy, mxHost, port);
      } else {
        conn = await Deno.connect({ hostname: mxHost, port });
      }
      break;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
  }

  if (!conn) {
    result.status = 'failed';
    result.error = `connect failed: ${lastErr ?? 'unknown'}`;
    return result;
  }

  const reader = conn.readable.getReader();
  const writer = conn.writable.getWriter();
  const buffer = { pending: '' };

  const closeQuiet = async () => {
    try {
      await writeLine(writer, 'QUIT').catch(() => {});
    } catch {
      /* ignore */
    }
    try {
      writer.releaseLock();
    } catch {
      /* ignore */
    }
    try {
      reader.releaseLock();
    } catch {
      /* ignore */
    }
    try {
      conn?.close();
    } catch {
      /* ignore */
    }
  };

  try {
    // Banner
    const banner = await readReply(reader, buffer, signal);
    if (banner.code !== 220) {
      result.status = 'failed';
      result.smtp_response_code = banner.code;
      result.error = `bad banner: ${banner.lines.join(' | ')}`;
      await closeQuiet();
      return result;
    }

    // EHLO
    await writeLine(writer, `EHLO ${opts.heloName}`);
    const ehlo = await readReply(reader, buffer, signal);
    if (ehlo.code !== 250) {
      result.status = 'failed';
      result.smtp_response_code = ehlo.code;
      result.error = `EHLO failed: ${ehlo.lines.join(' | ')}`;
      await closeQuiet();
      return result;
    }

    // MAIL FROM
    await writeLine(writer, `MAIL FROM:${opts.mailFrom}`);
    const mailFrom = await readReply(reader, buffer, signal);
    if (mailFrom.code !== 250) {
      result.status = 'failed';
      result.smtp_response_code = mailFrom.code;
      result.error = `MAIL FROM rejected: ${mailFrom.lines.join(' | ')}`;
      await closeQuiet();
      return result;
    }

    // RCPT TO (target)
    await writeLine(writer, `RCPT TO:<${email}>`);
    const rcpt = await readReply(reader, buffer, signal);
    result.smtp_response_code = rcpt.code;

    if (rcpt.code === 250) {
      result.status = 'verified';

      // Catch-all probe
      if (opts.catchAllProbe) {
        const domain = email.split('@')[1];
        const random = `aca-probe-${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
        await writeLine(writer, `RCPT TO:<${random}@${domain}>`);
        const probe = await readReply(reader, buffer, signal);
        if (probe.code === 250) {
          result.status = 'catch_all';
          result.catch_all = true;
        }
      }
    } else if (rcpt.code === 550 || rcpt.code === 551 || rcpt.code === 553) {
      result.status = 'not_found';
    } else if (rcpt.code === 421 || rcpt.code === 450 || rcpt.code === 451 || rcpt.code === 452) {
      result.status = 'retry';
      result.error = `tempfail: ${rcpt.lines.join(' | ')}`;
    } else {
      result.status = 'failed';
      result.error = `unexpected code ${rcpt.code}: ${rcpt.lines.join(' | ')}`;
    }

    await closeQuiet();
    return result;
  } catch (err) {
    result.status = err instanceof Error && err.message === 'timeout' ? 'retry' : 'failed';
    result.error = err instanceof Error ? err.message : String(err);
    await closeQuiet();
    return result;
  }
}

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

export async function verifyEmail(
  email: string,
  opts: VerifyOptions = {}
): Promise<VerificationResult> {
  const cleanedOpts = {
    timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    catchAllProbe: opts.catchAllProbe ?? true,
    heloName: opts.heloName ?? HELO_NAME,
    mailFrom: opts.mailFrom ?? MAIL_FROM,
    proxyId: opts.proxyId,
    proxy: opts.proxy,
  };

  const mxHosts = opts.mxHosts ?? [];
  if (mxHosts.length === 0) {
    return {
      email,
      status: 'failed' as VerificationStatus,
      smtp_response_code: null,
      catch_all: false,
      proxy_id: cleanedOpts.proxyId ?? null,
      attempts: 0,
      error: 'no mx hosts provided',
    };
  }

  let lastResult: VerificationResult | null = null;
  for (const host of mxHosts) {
    const r = await verifyAgainstHost(host, email, cleanedOpts);
    lastResult = r;
    if (r.status === 'verified' || r.status === 'catch_all' || r.status === 'not_found') {
      return r;
    }
  }
  return (
    lastResult ?? {
      email,
      status: 'failed',
      smtp_response_code: null,
      catch_all: false,
      proxy_id: cleanedOpts.proxyId ?? null,
      attempts: 1,
      error: 'no mx responded',
    }
  );
}

/**
 * Probe whether a domain is catch-all by RCPTing a guaranteed-random local
 * part. Cheaper than a full verifyEmail() when the caller only needs the
 * catch_all bit (e.g. populating pattern cache on import).
 */
export async function verifyDomainCatchAll(
  domain: string,
  mxHosts: string[],
  opts: VerifyOptions = {}
): Promise<{ catchAll: boolean; error?: string }> {
  const random = `aca-probe-${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
  const result = await verifyEmail(`${random}@${domain}`, {
    ...opts,
    mxHosts,
    catchAllProbe: false,
  });
  if (result.status === 'verified') return { catchAll: true };
  if (result.status === 'not_found') return { catchAll: false };
  return { catchAll: false, error: result.error };
}
