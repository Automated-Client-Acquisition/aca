/**
 * Raw Node SMTP client with pipelined RCPT TO support.
 *
 * Mirrors the EHLO / MAIL FROM / RCPT TO / QUIT state machine of the Deno
 * verifier in supabase/functions/_shared/list-building/smtp-verifier.ts,
 * but in Node. Do not import from the Deno version — protocol is re-implemented
 * here to stay on the Node runtime.
 */

import net from 'node:net';
import type { Socket } from 'node:net';

export interface SessionOptions {
  mxHost: string;
  port?: number;
  heloDomain: string;
  mailFrom: string;
  socketFactory?: () => Promise<Socket>;
  timeoutMs?: number;
}

export type RcptResult =
  | { code: 250; kind: 'ok'; raw: string }
  | { code: 421 | 450 | 451 | 452; kind: 'rate_limited'; raw: string }
  | { code: number; kind: 'rejected'; raw: string }
  | { code: 0; kind: 'error'; raw: string };

export class SmtpSession {
  private socket: Socket | null = null;
  private buffer = '';
  private resolveLine: ((line: string) => void) | null = null;
  private rcptCount = 0;
  private readonly timeoutMs: number;

  constructor(private readonly opts: SessionOptions) {
    this.timeoutMs = opts.timeoutMs ?? 15_000;
  }

  get rcptsSent(): number {
    return this.rcptCount;
  }

  async connect(): Promise<void> {
    this.socket = this.opts.socketFactory
      ? await this.opts.socketFactory()
      : net.createConnection({ host: this.opts.mxHost, port: this.opts.port ?? 25 });

    this.socket.setTimeout(this.timeoutMs);
    this.socket.on('data', (chunk) => this.onData(chunk));
    this.socket.on('error', () => this.close());
    this.socket.on('timeout', () => this.close());

    // 220 banner
    await this.readResponse();
    await this.sendCommand(`EHLO ${this.opts.heloDomain}`);
    await this.sendCommand(`MAIL FROM:<${this.opts.mailFrom}>`);
  }

  async verify(email: string): Promise<RcptResult> {
    if (!this.socket) {
      return { code: 0, kind: 'error', raw: 'not connected' };
    }
    try {
      const line = await this.sendCommandRaw(`RCPT TO:<${email}>`);
      this.rcptCount++;
      const code = parseInt(line.slice(0, 3), 10);
      if (code === 250) return { code, kind: 'ok', raw: line };
      if (code === 421 || code === 450 || code === 451 || code === 452) {
        return { code, kind: 'rate_limited', raw: line };
      }
      return { code: isNaN(code) ? 0 : code, kind: code >= 500 ? 'rejected' : 'error', raw: line } as RcptResult;
    } catch (err) {
      return { code: 0, kind: 'error', raw: err instanceof Error ? err.message : String(err) };
    }
  }

  async reset(): Promise<void> {
    try {
      await this.sendCommand('RSET');
      await this.sendCommand(`MAIL FROM:<${this.opts.mailFrom}>`);
    } catch {
      /* ignore — caller will drop session */
    }
  }

  async close(): Promise<void> {
    if (!this.socket) return;
    try {
      this.socket.write('QUIT\r\n');
    } catch { /* ignore */ }
    try { this.socket.destroy(); } catch { /* ignore */ }
    this.socket = null;
  }

  private onData(chunk: Buffer) {
    this.buffer += chunk.toString('utf8');
    const idx = this.buffer.indexOf('\r\n');
    if (idx === -1) return;
    const line = this.buffer.slice(0, idx);
    this.buffer = this.buffer.slice(idx + 2);
    if (this.resolveLine) {
      const r = this.resolveLine;
      this.resolveLine = null;
      r(line);
    }
  }

  private readResponse(): Promise<string> {
    return new Promise((resolve, reject) => {
      const to = setTimeout(() => reject(new Error('smtp read timeout')), this.timeoutMs);
      this.resolveLine = (line) => {
        clearTimeout(to);
        resolve(line);
      };
    });
  }

  private async sendCommand(cmd: string): Promise<string> {
    return this.sendCommandRaw(cmd);
  }

  private async sendCommandRaw(cmd: string): Promise<string> {
    if (!this.socket) throw new Error('socket closed');
    this.socket.write(cmd + '\r\n');
    return this.readResponse();
  }
}
