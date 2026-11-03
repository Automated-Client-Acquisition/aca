/**
 * DMARC aggregate report parser.
 *
 * Receivers (Gmail, Yahoo, Outlook, etc.) email an XML aggregate report to the
 * `rua` mailbox listed in the DMARC TXT record, daily. The XML follows
 * RFC 7489 Appendix C. We parse the structure that matters for cold email:
 *
 *   <feedback>
 *     <report_metadata>
 *       <org_name>google.com</org_name>
 *       <email>noreply-dmarc-support@google.com</email>
 *       <report_id>2026010100012345678</report_id>
 *       <date_range><begin>1735603200</begin><end>1735689600</end></date_range>
 *     </report_metadata>
 *     <policy_published>
 *       <domain>sales.acquist.io</domain>
 *       <p>quarantine</p>
 *       <pct>100</pct>
 *     </policy_published>
 *     <record>
 *       <row>
 *         <source_ip>135.181.55.42</source_ip>
 *         <count>42</count>
 *         <policy_evaluated>
 *           <disposition>none</disposition>
 *           <dkim>pass</dkim>
 *           <spf>pass</spf>
 *         </policy_evaluated>
 *       </row>
 *       <identifiers><header_from>sales.acquist.io</header_from></identifiers>
 *       <auth_results>
 *         <dkim><domain>sales.acquist.io</domain><result>pass</result></dkim>
 *         <spf><domain>sales.acquist.io</domain><result>pass</result></spf>
 *       </auth_results>
 *     </record>
 *     ...more records...
 *   </feedback>
 *
 * Reports come gzipped (.gz) or zipped (.zip); we expect the IMAP poller to
 * unzip before passing the XML string in.
 */

export interface ParsedDmarcReport {
  report_id: string;
  org_name: string;
  report_email: string | null;
  date_range_begin: Date;
  date_range_end: Date;
  policy_domain: string;
  policy_p: string | null;
  policy_pct: number | null;
  records: ParsedDmarcRecord[];
  total_messages: number;
  spf_pass_count: number;
  dkim_pass_count: number;
  dmarc_pass_count: number;
  alignment_failures: AlignmentFailure[];
}

export interface ParsedDmarcRecord {
  source_ip: string;
  count: number;
  disposition: string;
  dkim_aligned: boolean;
  spf_aligned: boolean;
  header_from: string;
}

export interface AlignmentFailure {
  source_ip: string;
  count: number;
  spf_aligned: boolean;
  dkim_aligned: boolean;
}

/**
 * Tiny pure-string XML extractor — avoids bundling a full XML parser in the
 * Deno edge function. Handles: nested tags, XML namespaces stripped,
 * whitespace-tolerant. Doesn't handle CDATA, comments, or attributes (DMARC
 * reports don't use them).
 */
function getText(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = xml.match(re);
  return m ? m[1].trim() : null;
}

function getAll(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}

function unixToDate(unixSec: string | null): Date {
  if (!unixSec) return new Date();
  return new Date(parseInt(unixSec, 10) * 1000);
}

/**
 * Parse a DMARC aggregate report. Returns null if the input doesn't look
 * like a valid <feedback> XML.
 */
export function parseDmarcReport(xml: string): ParsedDmarcReport | null {
  if (!xml || !xml.includes('<feedback')) return null;

  const reportMeta = getText(xml, 'report_metadata') ?? '';
  const policy = getText(xml, 'policy_published') ?? '';
  const dateRange = getText(reportMeta, 'date_range') ?? '';

  const report_id = getText(reportMeta, 'report_id') ?? '';
  const org_name = getText(reportMeta, 'org_name') ?? '';
  if (!report_id || !org_name) return null;

  const records: ParsedDmarcRecord[] = [];
  let total_messages = 0;
  let spf_pass_count = 0;
  let dkim_pass_count = 0;
  let dmarc_pass_count = 0;
  const alignmentFailureMap = new Map<string, AlignmentFailure>();

  for (const rec of getAll(xml, 'record')) {
    const row = getText(rec, 'row') ?? '';
    const auth = getText(rec, 'auth_results') ?? '';
    const ids = getText(rec, 'identifiers') ?? '';
    const policyEval = getText(row, 'policy_evaluated') ?? '';
    const source_ip = getText(row, 'source_ip') ?? '';
    const count = parseInt(getText(row, 'count') ?? '0', 10);
    const disposition = getText(policyEval, 'disposition') ?? 'none';

    // policy_evaluated/dkim and spf are the *aligned* results — what DMARC
    // actually uses for the disposition decision. auth_results has the raw
    // SPF/DKIM verifier output.
    const dkim_aligned = (getText(policyEval, 'dkim') ?? '').toLowerCase() === 'pass';
    const spf_aligned = (getText(policyEval, 'spf') ?? '').toLowerCase() === 'pass';
    const dkim_raw_pass = (getText(auth, 'dkim')?.match(/<result>(.*?)<\/result>/i)?.[1] ?? '').toLowerCase() === 'pass';
    const spf_raw_pass = (getText(auth, 'spf')?.match(/<result>(.*?)<\/result>/i)?.[1] ?? '').toLowerCase() === 'pass';
    const header_from = getText(ids, 'header_from') ?? '';

    records.push({ source_ip, count, disposition, dkim_aligned, spf_aligned, header_from });

    total_messages += count;
    if (spf_raw_pass) spf_pass_count += count;
    if (dkim_raw_pass) dkim_pass_count += count;
    if (dkim_aligned || spf_aligned) {
      dmarc_pass_count += count;
    } else {
      // Alignment failure — track per source IP for the operator.
      const existing = alignmentFailureMap.get(source_ip);
      if (existing) {
        existing.count += count;
      } else {
        alignmentFailureMap.set(source_ip, {
          source_ip,
          count,
          spf_aligned,
          dkim_aligned,
        });
      }
    }
  }

  return {
    report_id,
    org_name,
    report_email: getText(reportMeta, 'email'),
    date_range_begin: unixToDate(getText(dateRange, 'begin')),
    date_range_end: unixToDate(getText(dateRange, 'end')),
    policy_domain: getText(policy, 'domain') ?? '',
    policy_p: getText(policy, 'p'),
    policy_pct: parseInt(getText(policy, 'pct') ?? '100', 10),
    records,
    total_messages,
    spf_pass_count,
    dkim_pass_count,
    dmarc_pass_count,
    alignment_failures: Array.from(alignmentFailureMap.values()),
  };
}

/**
 * Decompress a gzipped DMARC report. DMARC reports usually arrive as .gz or
 * .zip MIME attachments; the IMAP poller decodes the attachment and passes
 * the raw bytes here.
 */
export async function decompressGz(bytes: Uint8Array): Promise<string> {
  // Use the DecompressionStream Web API (available in Deno).
  const blob = new Blob([bytes as unknown as BlobPart]);
  const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
  const text = await new Response(stream).text();
  return text;
}

export interface ZipXmlEntry {
  name: string;
  text: string;
}

/**
 * Extract .xml entries from a ZIP archive. Google sends DMARC reports as
 * .zip (everyone else uses .gz); the mailbox poller needs both.
 *
 * Minimal reader for the common case ACA sees: standard ZIP, STORED (0) or
 * DEFLATE (8) compression, no encryption, no spanning. Walks the central
 * directory (located via the End Of Central Directory record) rather than
 * scanning local file headers sequentially, since local headers can carry
 * a data-descriptor-deferred size that isn't reliable to read directly.
 */
export async function extractZipXmlEntries(bytes: Uint8Array): Promise<ZipXmlEntry[]> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const EOCD_SIG = 0x06054b50;
  const CD_SIG = 0x02014b50;
  const LFH_SIG = 0x04034b50;
  const maxCommentLen = 65535;
  const searchFloor = Math.max(0, bytes.length - 22 - maxCommentLen);

  let eocdOffset = -1;
  for (let i = bytes.length - 22; i >= searchFloor; i--) {
    if (view.getUint32(i, true) === EOCD_SIG) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) throw new Error('Not a valid ZIP file (EOCD record not found)');

  const entryCount = view.getUint16(eocdOffset + 10, true);
  let cdOffset = view.getUint32(eocdOffset + 16, true);

  const entries: ZipXmlEntry[] = [];
  for (let i = 0; i < entryCount; i++) {
    if (view.getUint32(cdOffset, true) !== CD_SIG) {
      throw new Error(`Malformed ZIP central directory at entry ${i}`);
    }
    const compressionMethod = view.getUint16(cdOffset + 10, true);
    const compressedSize = view.getUint32(cdOffset + 20, true);
    const fileNameLen = view.getUint16(cdOffset + 28, true);
    const extraLen = view.getUint16(cdOffset + 30, true);
    const commentLen = view.getUint16(cdOffset + 32, true);
    const localHeaderOffset = view.getUint32(cdOffset + 42, true);
    const name = new TextDecoder().decode(bytes.slice(cdOffset + 46, cdOffset + 46 + fileNameLen));

    if (view.getUint32(localHeaderOffset, true) !== LFH_SIG) {
      throw new Error(`Bad local file header for ZIP entry "${name}"`);
    }
    const lfhNameLen = view.getUint16(localHeaderOffset + 26, true);
    const lfhExtraLen = view.getUint16(localHeaderOffset + 28, true);
    const dataStart = localHeaderOffset + 30 + lfhNameLen + lfhExtraLen;
    const compressedData = bytes.slice(dataStart, dataStart + compressedSize);

    if (name.toLowerCase().endsWith('.xml')) {
      let text: string;
      if (compressionMethod === 0) {
        text = new TextDecoder().decode(compressedData);
      } else if (compressionMethod === 8) {
        const stream = new Blob([compressedData as unknown as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        text = await new Response(stream).text();
      } else {
        throw new Error(`Unsupported ZIP compression method ${compressionMethod} for entry "${name}"`);
      }
      entries.push({ name, text });
    }

    cdOffset += 46 + fileNameLen + extraLen + commentLen;
  }

  return entries;
}
