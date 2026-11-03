/**
 * Twitter OAuth 1.0a request signing utility
 *
 * Implements HMAC-SHA1 signature generation for Twitter API v2 requests.
 * Used by validate-twitter and publish-to-twitter edge functions.
 */

function percentEncode(str: string): string {
  return encodeURIComponent(str)
    .replace(/!/g, '%21')
    .replace(/\*/g, '%2A')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29');
}

function generateNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  const values = crypto.getRandomValues(new Uint8Array(32));
  for (const v of values) {
    nonce += chars[v % chars.length];
  }
  return nonce;
}

/**
 * Build an OAuth 1.0a Authorization header for a Twitter API request.
 *
 * @param method - HTTP method (GET, POST, etc.)
 * @param url - Full request URL (without query params for signing)
 * @param consumerKey - Twitter API consumer key
 * @param consumerSecret - Twitter API consumer secret
 * @param accessToken - User's access token
 * @param accessTokenSecret - User's access token secret
 * @param extraParams - Additional params to include in signature (e.g., query params or form body params)
 * @returns The full Authorization header value
 */
export async function buildAuthHeader(
  method: string,
  url: string,
  consumerKey: string,
  consumerSecret: string,
  accessToken: string,
  accessTokenSecret: string,
  extraParams?: Record<string, string>
): Promise<string> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = generateNonce();

  // OAuth params
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: timestamp,
    oauth_token: accessToken,
    oauth_version: '1.0',
  };

  // Combine all params for signature base string
  const allParams: Record<string, string> = { ...oauthParams };
  if (extraParams) {
    for (const [k, v] of Object.entries(extraParams)) {
      allParams[k] = v;
    }
  }

  // Sort and encode params
  const sortedParams = Object.keys(allParams)
    .sort()
    .map(k => `${percentEncode(k)}=${percentEncode(allParams[k])}`)
    .join('&');

  // Build signature base string
  const baseString = `${method.toUpperCase()}&${percentEncode(url)}&${percentEncode(sortedParams)}`;

  // Build signing key
  const signingKey = `${percentEncode(consumerSecret)}&${percentEncode(accessTokenSecret)}`;

  // HMAC-SHA1 sign
  const keyData = new TextEncoder().encode(signingKey);
  const messageData = new TextEncoder().encode(baseString);

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
  const signatureBase64 = btoa(String.fromCharCode(...new Uint8Array(signature)));

  // Build Authorization header
  const authParams = {
    ...oauthParams,
    oauth_signature: signatureBase64,
  };

  const headerValue = Object.keys(authParams)
    .sort()
    .map(k => `${percentEncode(k)}="${percentEncode(authParams[k])}"`)
    .join(', ');

  return `OAuth ${headerValue}`;
}
