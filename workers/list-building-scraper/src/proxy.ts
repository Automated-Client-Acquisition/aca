import type { LaunchOptions } from 'playwright';
import type { ProxyConfig } from './types.js';

/**
 * Translate a ProxyConfig into Playwright's launch/context proxy option.
 * Returns undefined when no proxy is configured so callers can spread it
 * conditionally.
 */
export function buildProxyOption(
  proxy?: ProxyConfig | null,
): LaunchOptions['proxy'] | undefined {
  if (!proxy || !proxy.host || !proxy.port) return undefined;
  return {
    server: `http://${proxy.host}:${proxy.port}`,
    username: proxy.username,
    password: proxy.password,
  };
}
