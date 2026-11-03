/**
 * BYO SSH Keypair Generation
 *
 * Generates an Ed25519 SSH keypair using Deno's Web Crypto API.
 * Outputs:
 *   - publicKey:  OpenSSH single-line format ("ssh-ed25519 AAAA... comment")
 *   - privateKey: OpenSSH private-key PEM ("-----BEGIN OPENSSH PRIVATE KEY-----")
 *
 * ssh2/node-ssh on the deployer side does NOT accept PKCS#8 PEM for Ed25519, so
 * we build the OpenSSH format directly here.
 */

export interface BYOKeypair {
  publicKey: string;        // OpenSSH single-line ("ssh-ed25519 AAA... comment")
  privateKeyPem: string;    // OpenSSH PEM ("-----BEGIN OPENSSH PRIVATE KEY----- ...")
  fingerprint: string;      // SHA-256 fingerprint, OpenSSH format ("SHA256:abc...")
}

const SSH_KEY_TYPE = 'ssh-ed25519';

function base64Encode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function pemEncode(label: string, bytes: Uint8Array): string {
  const b64 = base64Encode(bytes);
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += 70) lines.push(b64.slice(i, i + 70));
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`;
}

/**
 * Build the SSH wire-format public key blob for ed25519:
 *   string "ssh-ed25519"  (4-byte length-prefixed)
 *   string raw_pubkey     (4-byte length-prefixed, 32 bytes)
 */
function buildEd25519PublicBlob(rawPubKey: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(SSH_KEY_TYPE);
  const blob = new Uint8Array(4 + typeBytes.length + 4 + rawPubKey.length);
  const view = new DataView(blob.buffer);
  let offset = 0;
  view.setUint32(offset, typeBytes.length, false); offset += 4;
  blob.set(typeBytes, offset); offset += typeBytes.length;
  view.setUint32(offset, rawPubKey.length, false); offset += 4;
  blob.set(rawPubKey, offset);
  return blob;
}

/**
 * Length-prefixed string for SSH wire format: 4-byte BE length + bytes.
 */
function sshString(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + bytes.length);
  new DataView(out.buffer).setUint32(0, bytes.length, false);
  out.set(bytes, 4);
  return out;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

/**
 * Extract the 32-byte raw Ed25519 private key from a PKCS#8 DER blob.
 *
 * PKCS#8 layout for Ed25519:
 *   SEQUENCE { INTEGER 0, SEQUENCE { OID 1.3.101.112 }, OCTET STRING { OCTET STRING <32 bytes> } }
 * The inner 32 raw private bytes always sit at the end of the buffer.
 */
function extractEd25519RawPrivate(pkcs8: Uint8Array): Uint8Array {
  if (pkcs8.length < 32) throw new Error('PKCS8 too short');
  return pkcs8.slice(pkcs8.length - 32);
}

/**
 * Build OpenSSH private-key blob (RFC: openssh-key-v1).
 */
function buildOpenSshPrivateKey(rawPub: Uint8Array, rawPriv: Uint8Array, comment: string): Uint8Array {
  const enc = new TextEncoder();
  const magic = enc.encode('openssh-key-v1\0');

  const ciphername = sshString(enc.encode('none'));
  const kdfname = sshString(enc.encode('none'));
  const kdfopts = sshString(new Uint8Array(0));
  const numKeys = new Uint8Array(4);
  new DataView(numKeys.buffer).setUint32(0, 1, false);

  // Public key section: length-prefixed wire blob.
  const pubBlob = buildEd25519PublicBlob(rawPub);
  const publicSection = sshString(pubBlob);

  // Private section (unencrypted because ciphername=none).
  const checkInt = crypto.getRandomValues(new Uint8Array(4));
  // private key bytes per OpenSSH ed25519: 64 bytes = priv (32) || pub (32)
  const privConcat = new Uint8Array(64);
  privConcat.set(rawPriv, 0);
  privConcat.set(rawPub, 32);

  const privInner = concatBytes(
    checkInt,
    checkInt,
    sshString(enc.encode(SSH_KEY_TYPE)),
    sshString(rawPub),
    sshString(privConcat),
    sshString(enc.encode(comment)),
  );

  // Pad to multiple of 8 (cipher block size, even with "none")
  const padLen = (8 - (privInner.length % 8)) % 8;
  const padding = new Uint8Array(padLen);
  for (let i = 0; i < padLen; i++) padding[i] = i + 1;
  const privSection = sshString(concatBytes(privInner, padding));

  return concatBytes(magic, ciphername, kdfname, kdfopts, numKeys, publicSection, privSection);
}

async function computeOpenSshFingerprint(publicBlob: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', publicBlob);
  const b64 = base64Encode(new Uint8Array(hash)).replace(/=+$/, '');
  return `SHA256:${b64}`;
}

/**
 * Generate a new BYO SSH keypair (Ed25519, OpenSSH format).
 */
export async function generateByoKeypair(comment: string): Promise<BYOKeypair> {
  const safeComment = (comment || 'aca-byo').replace(/[^A-Za-z0-9_.@-]/g, '_').slice(0, 64);

  const keyPair = (await crypto.subtle.generateKey(
    { name: 'Ed25519' } as unknown as AlgorithmIdentifier,
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;

  const rawPublic = new Uint8Array(await crypto.subtle.exportKey('raw', keyPair.publicKey));
  if (rawPublic.length !== 32) {
    throw new Error(`Unexpected raw Ed25519 public key length: ${rawPublic.length}`);
  }

  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', keyPair.privateKey));
  const rawPrivate = extractEd25519RawPrivate(pkcs8);

  const publicBlob = buildEd25519PublicBlob(rawPublic);
  const publicKey = `${SSH_KEY_TYPE} ${base64Encode(publicBlob)} ${safeComment}`;

  const opensshBlob = buildOpenSshPrivateKey(rawPublic, rawPrivate, safeComment);
  const privateKeyPem = pemEncode('OPENSSH PRIVATE KEY', opensshBlob);

  const fingerprint = await computeOpenSshFingerprint(publicBlob);

  return { publicKey, privateKeyPem, fingerprint };
}
