import { fetchText, RateLimiter } from '../http.js';

const GOOGLE_NEWS_ARTICLE_LIMITER = new RateLimiter(1);
const GOOGLE_NEWS_PAGE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'max-age=0',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Upgrade-Insecure-Requests': '1',
};
const BATCH_EXECUTE_URL = 'https://news.google.com/_/DotsSplashUi/data/batchexecute';

export function googleNewsArticleToken(sourceUrl: string): string | null {
  try {
    const url = new URL(sourceUrl);
    if (url.hostname !== 'news.google.com') return null;
    const path = url.pathname.split('/').filter(Boolean);
    const marker = path.findIndex((part) => part === 'articles' || part === 'read');
    return marker >= 0 && path[marker + 1] ? decodeURIComponent(path[marker + 1]) : null;
  } catch {
    return null;
  }
}

export function decodingParams(html: string): { signature: string; timestamp: string } | null {
  const signature = html.match(/data-n-a-sg="([^"]+)"/i)?.[1];
  const timestamp = html.match(/data-n-a-ts="(\d+)"/i)?.[1];
  return signature && timestamp ? { signature, timestamp } : null;
}

export function decodedUrlFromBatchResponse(body: string): string | null {
  try {
    const json = body.split('\n\n')[1];
    if (!json) return null;
    const chunks = JSON.parse(json) as unknown[];
    const decodedChunk = chunks.find((chunk): chunk is [string, string, string] =>
      Array.isArray(chunk)
      && (chunk[0] === 'wrb.fr' || chunk[0] === 'w779db')
      && chunk[1] === 'Fbv4je'
      && typeof chunk[2] === 'string',
    );
    if (!decodedChunk) return null;
    const payload = JSON.parse(decodedChunk[2]) as unknown[];
    return typeof payload[1] === 'string' && /^https?:\/\//i.test(payload[1]) ? payload[1] : null;
  } catch {
    return null;
  }
}

function batchRequest(articleToken: string, signature: string, timestamp: string): string {
  const request = [
    'garturlreq',
    [['X', 'X', ['X', 'X'], null, null, 1, 1, 'US:en', null, 1, null, null, null, null, null, 0, 1], 'X', 'X', 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0],
    articleToken,
    Number(timestamp),
    signature,
  ];
  return `f.req=${encodeURIComponent(JSON.stringify([[["Fbv4je", JSON.stringify(request)]]]))}`;
}

/** Resolve a Google News RSS wrapper from the Fly worker network. */
export async function resolveGoogleNewsArticle(sourceUrl: string): Promise<{ url: string | null; reason: string }> {
  const articleToken = googleNewsArticleToken(sourceUrl);
  if (!articleToken) return { url: null, reason: 'invalid_google_news_url' };
  try {
    const page = await fetchText(`https://news.google.com/rss/articles/${articleToken}`, {
      headers: GOOGLE_NEWS_PAGE_HEADERS,
      limiter: GOOGLE_NEWS_ARTICLE_LIMITER,
      retries: 1,
      timeoutMs: 20_000,
    });
    const params = page ? decodingParams(page) : null;
    if (!params) return { url: null, reason: 'google_news_decode_params_missing' };

    const response = await fetch(BATCH_EXECUTE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        Accept: '*/*',
        Origin: 'https://news.google.com',
        Referer: 'https://news.google.com/',
        'User-Agent': GOOGLE_NEWS_PAGE_HEADERS['User-Agent'],
      },
      body: batchRequest(articleToken, params.signature, params.timestamp),
    });
    if (!response.ok) return { url: null, reason: `google_news_decode_http_${response.status}` };
    const url = decodedUrlFromBatchResponse(await response.text());
    return url ? { url, reason: 'canonical_url_resolved' } : { url: null, reason: 'google_news_decode_response_invalid' };
  } catch (error) {
    return { url: null, reason: error instanceof Error ? error.message.slice(0, 180) : 'google_news_decode_failed' };
  }
}
