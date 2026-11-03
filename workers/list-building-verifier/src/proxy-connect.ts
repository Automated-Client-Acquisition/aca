/**
 * SOCKS5 + HTTP CONNECT tunneling helpers.
 * Returns a net.Socket ready for use by smtp-session.ts.
 */

import net from 'node:net';
import type { Socket } from 'node:net';
import { SocksClient } from 'socks';

export interface ProxyConfig {
  kind: 'socks5' | 'http';
  host: string;
  port: number;
  username?: string;
  password?: string;
}

export async function connectThroughProxy(
  proxy: ProxyConfig,
  targetHost: string,
  targetPort: number,
): Promise<Socket> {
  if (proxy.kind === 'socks5') {
    const { socket } = await SocksClient.createConnection({
      proxy: {
        host: proxy.host,
        port: proxy.port,
        type: 5,
        userId: proxy.username,
        password: proxy.password,
      },
      command: 'connect',
      destination: { host: targetHost, port: targetPort },
      timeout: 15_000,
    });
    return socket as Socket;
  }

  // HTTP CONNECT
  return new Promise<Socket>((resolve, reject) => {
    const socket = net.createConnection({ host: proxy.host, port: proxy.port });
    socket.once('error', reject);
    socket.once('connect', () => {
      const auth = proxy.username
        ? `Proxy-Authorization: Basic ${Buffer.from(`${proxy.username}:${proxy.password ?? ''}`).toString('base64')}\r\n`
        : '';
      socket.write(
        `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\n${auth}\r\n`,
      );
      let buf = '';
      const onData = (chunk: Buffer) => {
        buf += chunk.toString('utf8');
        if (buf.includes('\r\n\r\n')) {
          socket.off('data', onData);
          const statusLine = buf.split('\r\n')[0] ?? '';
          const m = /HTTP\/1\.[01]\s+(\d+)/.exec(statusLine);
          if (m && m[1].startsWith('2')) {
            resolve(socket);
          } else {
            socket.destroy();
            reject(new Error(`HTTP CONNECT failed: ${statusLine}`));
          }
        }
      };
      socket.on('data', onData);
    });
  });
}

export async function directConnect(host: string, port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    socket.once('error', reject);
    socket.once('connect', () => resolve(socket));
  });
}
