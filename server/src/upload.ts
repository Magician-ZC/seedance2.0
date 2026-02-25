// 图片上传到 ImageX CDN (4步流程)
import crypto from 'crypto';
import { jimengRequest } from './jimeng-api.js';
import { FAKE_HEADERS, calculateCRC32, createAWSSignature } from './utils.js';

export async function uploadImageBuffer(buffer: Buffer, sessionId: string): Promise<string> {
  console.log(`  [upload] 开始上传图片, 大小: ${buffer.length} 字节`);

  // 第1步: 获取上传令牌
  const tokenResult = await jimengRequest('post', '/mweb/v1/get_upload_token', sessionId, { data: { scene: 2 } });
  const { access_key_id, secret_access_key, session_token, service_id } = tokenResult as Record<string, string>;
  if (!access_key_id || !secret_access_key || !session_token) throw new Error('获取上传令牌失败');
  const actualServiceId = service_id || 'tb4s082cfz';
  console.log(`  [upload] 上传令牌获取成功: serviceId=${actualServiceId}`);

  const fileSize = buffer.length;
  const crc32 = calculateCRC32(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer);

  // 第2步: 申请上传权限
  const timestamp = new Date().toISOString().replace(/[:\-]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const randomStr = Math.random().toString(36).substring(2, 12);
  const applyUrl = `https://imagex.bytedanceapi.com/?Action=ApplyImageUpload&Version=2018-08-01&ServiceId=${actualServiceId}&FileSize=${fileSize}&s=${randomStr}`;

  const reqHeaders: Record<string, string> = { 'x-amz-date': timestamp, 'x-amz-security-token': session_token };
  const authorization = createAWSSignature('GET', applyUrl, reqHeaders, access_key_id, secret_access_key, session_token);

  const applyResponse = await fetch(applyUrl, {
    method: 'GET',
    headers: {
      accept: '*/*', authorization, origin: 'https://jimeng.jianying.com',
      referer: 'https://jimeng.jianying.com/ai-tool/video/generate',
      'user-agent': FAKE_HEADERS['User-Agent'], 'x-amz-date': timestamp, 'x-amz-security-token': session_token,
    },
  });
  if (!applyResponse.ok) throw new Error(`申请上传权限失败: ${applyResponse.status}`);

  const applyResult = (await applyResponse.json()) as Record<string, unknown>;
  const meta = applyResult?.ResponseMetadata as Record<string, unknown> | undefined;
  if (meta?.Error) throw new Error(`申请上传权限失败: ${JSON.stringify(meta.Error)}`);

  const result = applyResult?.Result as Record<string, unknown>;
  const uploadAddress = result?.UploadAddress as Record<string, unknown>;
  const storeInfos = uploadAddress?.StoreInfos as Array<Record<string, string>>;
  const uploadHosts = uploadAddress?.UploadHosts as string[];
  if (!storeInfos?.length || !uploadHosts?.length) throw new Error('获取上传地址失败');

  const storeInfo = storeInfos[0];
  const uploadHost = uploadHosts[0];
  const uploadUrl = `https://${uploadHost}/upload/v1/${storeInfo.StoreUri}`;
  console.log(`  [upload] 上传图片到: ${uploadHost}`);

  // 第3步: 上传图片文件
  const uploadResponse = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Accept: '*/*', Authorization: storeInfo.Auth, 'Content-CRC32': crc32,
      'Content-Disposition': 'attachment; filename="undefined"', 'Content-Type': 'application/octet-stream',
      Origin: 'https://jimeng.jianying.com', Referer: 'https://jimeng.jianying.com/ai-tool/video/generate',
      'User-Agent': FAKE_HEADERS['User-Agent'],
    },
    body: buffer,
  });
  if (!uploadResponse.ok) throw new Error(`图片上传失败: ${uploadResponse.status}`);
  console.log(`  [upload] 图片文件上传成功`);

  // 第4步: 提交上传
  const commitUrl = `https://imagex.bytedanceapi.com/?Action=CommitImageUpload&Version=2018-08-01&ServiceId=${actualServiceId}`;
  const commitTimestamp = new Date().toISOString().replace(/[:\-]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const commitPayload = JSON.stringify({ SessionKey: (uploadAddress as Record<string, unknown>).SessionKey, SuccessActionStatus: '200' });
  const payloadHash = crypto.createHash('sha256').update(commitPayload, 'utf8').digest('hex');

  const commitReqHeaders: Record<string, string> = {
    'x-amz-date': commitTimestamp, 'x-amz-security-token': session_token, 'x-amz-content-sha256': payloadHash,
  };
  const commitAuth = createAWSSignature('POST', commitUrl, commitReqHeaders, access_key_id, secret_access_key, session_token, commitPayload);

  const commitResponse = await fetch(commitUrl, {
    method: 'POST',
    headers: {
      accept: '*/*', authorization: commitAuth, 'content-type': 'application/json',
      origin: 'https://jimeng.jianying.com', referer: 'https://jimeng.jianying.com/ai-tool/video/generate',
      'user-agent': FAKE_HEADERS['User-Agent'], 'x-amz-date': commitTimestamp,
      'x-amz-security-token': session_token, 'x-amz-content-sha256': payloadHash,
    },
    body: commitPayload,
  });
  if (!commitResponse.ok) throw new Error(`提交上传失败: ${commitResponse.status}`);

  const commitResult = (await commitResponse.json()) as Record<string, unknown>;
  const commitMeta = commitResult?.ResponseMetadata as Record<string, unknown> | undefined;
  if (commitMeta?.Error) throw new Error(`提交上传失败: ${JSON.stringify(commitMeta.Error)}`);

  const commitResultData = commitResult?.Result as Record<string, unknown>;
  const results = commitResultData?.Results as Array<Record<string, unknown>>;
  if (!results?.length) throw new Error('提交上传响应缺少结果');
  if (results[0].UriStatus !== 2000) throw new Error(`图片上传状态异常: UriStatus=${results[0].UriStatus}`);

  const pluginResult = commitResultData?.PluginResult as Array<Record<string, string>> | undefined;
  const imageUri = pluginResult?.[0]?.ImageUri || (results[0].Uri as string);
  console.log(`  [upload] 图片上传完成: ${imageUri}`);
  return imageUri;
}
