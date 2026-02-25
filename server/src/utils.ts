// 通用工具函数
import crypto from 'crypto';

const VERSION_CODE = '8.4.0';
const PLATFORM_CODE = '7';

export const WEB_ID = Math.random() * 999999999999999999 + 7000000000000000000;
export const USER_ID = crypto.randomUUID().replace(/-/g, '');
export const DEFAULT_ASSISTANT_ID = 513695;
export const SEEDANCE_DRAFT_VERSION = '3.3.9';
export const JIMENG_BASE_URL = 'https://jimeng.jianying.com';

export const FAKE_HEADERS: Record<string, string> = {
  Accept: 'application/json, text/plain, */*',
  'Accept-Encoding': 'gzip, deflate, br, zstd',
  'Accept-language': 'zh-CN,zh;q=0.9',
  'App-Sdk-Version': '48.0.0',
  'Cache-control': 'no-cache',
  Appid: String(DEFAULT_ASSISTANT_ID),
  Appvr: VERSION_CODE,
  Lan: 'zh-Hans',
  Loc: 'cn',
  Origin: 'https://jimeng.jianying.com',
  Pragma: 'no-cache',
  Priority: 'u=1, i',
  Referer: 'https://jimeng.jianying.com',
  Pf: PLATFORM_CODE,
  'Sec-Ch-Ua': '"Google Chrome";v="132", "Chromium";v="132", "Not_A Brand";v="8"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
};

export function generateUUID(): string {
  return crypto.randomUUID();
}

export function unixTimestamp(): number {
  return Math.floor(Date.now() / 1000);
}

export function md5(value: string): string {
  return crypto.createHash('md5').update(value).digest('hex');
}

export function generateCookie(sessionId: string): string {
  return [
    `_tea_web_id=${WEB_ID}`,
    `is_staff_user=false`,
    `store-region=cn-gd`,
    `store-region-src=uid`,
    `uid_tt=${USER_ID}`,
    `uid_tt_ss=${USER_ID}`,
    `sid_tt=${sessionId}`,
    `sessionid=${sessionId}`,
    `sessionid_ss=${sessionId}`,
  ].join('; ');
}

export function generateSign(uri: string): { deviceTime: number; sign: string } {
  const deviceTime = unixTimestamp();
  const sign = md5(`9e2c|${uri.slice(-7)}|${PLATFORM_CODE}|${VERSION_CODE}|${deviceTime}||11ac`);
  return { deviceTime, sign };
}

// CRC32 计算
export function calculateCRC32(buffer: ArrayBuffer): string {
  const crcTable: number[] = [];
  for (let i = 0; i < 256; i++) {
    let crc = i;
    for (let j = 0; j < 8; j++) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    crcTable[i] = crc;
  }
  let crc = 0 ^ -1;
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ bytes[i]) & 0xff];
  }
  return ((crc ^ -1) >>> 0).toString(16).padStart(8, '0');
}

// AWS4-HMAC-SHA256 签名
export function createAWSSignature(
  method: string,
  url: string,
  headers: Record<string, string>,
  accessKeyId: string,
  secretAccessKey: string,
  sessionToken: string,
  payload = '',
): string {
  const urlObj = new URL(url);
  const pathname = urlObj.pathname || '/';
  const timestamp = headers['x-amz-date'];
  const date = timestamp.substr(0, 8);
  const region = 'cn-north-1';
  const service = 'imagex';

  const queryParams: [string, string][] = [];
  urlObj.searchParams.forEach((value, key) => {
    queryParams.push([key, value]);
  });
  queryParams.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const canonicalQueryString = queryParams.map(([k, v]) => `${k}=${v}`).join('&');

  const headersToSign: Record<string, string> = { 'x-amz-date': timestamp };
  if (sessionToken) headersToSign['x-amz-security-token'] = sessionToken;

  let payloadHash = crypto.createHash('sha256').update('').digest('hex');
  if (method.toUpperCase() === 'POST' && payload) {
    payloadHash = crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
    headersToSign['x-amz-content-sha256'] = payloadHash;
  }

  const signedHeaders = Object.keys(headersToSign).map((k) => k.toLowerCase()).sort().join(';');
  const canonicalHeaders = Object.keys(headersToSign)
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .map((k) => `${k.toLowerCase()}:${headersToSign[k].trim()}\n`)
    .join('');

  const canonicalRequest = [method.toUpperCase(), pathname, canonicalQueryString, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const credentialScope = `${date}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', timestamp, credentialScope, crypto.createHash('sha256').update(canonicalRequest, 'utf8').digest('hex')].join('\n');

  const kDate = crypto.createHmac('sha256', `AWS4${secretAccessKey}`).update(date).digest();
  const kRegion = crypto.createHmac('sha256', kDate).update(region).digest();
  const kService = crypto.createHmac('sha256', kRegion).update(service).digest();
  const kSigning = crypto.createHmac('sha256', kService).update('aws4_request').digest();
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

  return `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}
