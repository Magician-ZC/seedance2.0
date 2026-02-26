// 通用素材上传服务
export interface UploadedFile {
  name: string;
  url: string;
  size: number;
}

/**
 * 上传素材文件到 /api/upload-material
 * @returns 上传成功后的 URL 列表
 */
export async function uploadMaterials(files: FileList | File[]): Promise<string[]> {
  const fd = new FormData();
  for (const file of Array.from(files)) {
    fd.append('files', file);
  }
  const res = await fetch('/api/upload-material', { method: 'POST', body: fd });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: '上传失败' }));
    throw new Error(data.error || `上传失败 (${res.status})`);
  }
  const data = await res.json();
  return data.urls || [];
}

/**
 * 获取已上传的素材列表
 */
export async function listMaterials(): Promise<UploadedFile[]> {
  const res = await fetch('/api/materials');
  if (!res.ok) return [];
  const data = await res.json();
  return data.files || [];
}

/**
 * 删除已上传的素材
 */
export async function deleteMaterial(filename: string): Promise<boolean> {
  const res = await fetch(`/api/material/${encodeURIComponent(filename)}`, { method: 'DELETE' });
  return res.ok;
}
