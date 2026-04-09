// 制片模块 API 服务层
const API = '/api/production';

export async function createProductionProject(title: string, config?: Record<string, unknown>, requirementsText?: string) {
  const resp = await fetch(`${API}/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, config, requirementsText }),
  });
  return resp.json();
}

export async function listProductionProjects() {
  const resp = await fetch(`${API}/list`);
  return resp.json();
}

export async function getProductionProject(id: string) {
  const resp = await fetch(`${API}/${id}`);
  return resp.json();
}

export async function deleteProductionProject(id: string) {
  const resp = await fetch(`${API}/${id}`, { method: 'DELETE' });
  return resp.json();
}

export async function uploadScripts(projectId: string, files: File[]) {
  const formData = new FormData();
  files.forEach(f => formData.append('scripts', f));
  const resp = await fetch(`${API}/${projectId}/upload-script`, { method: 'POST', body: formData });
  return resp.json();
}

export async function cleanScripts(projectId: string, useAI = true) {
  const resp = await fetch(`${API}/${projectId}/clean-script`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ useAI }),
  });
  return resp.json();
}

export async function extractAssets(projectId: string) {
  const resp = await fetch(`${API}/${projectId}/assets/extract`, { method: 'POST' });
  return resp.json();
}

export async function getAssets(projectId: string, type?: string) {
  const url = type ? `${API}/${projectId}/assets?type=${type}` : `${API}/${projectId}/assets`;
  const resp = await fetch(url);
  return resp.json();
}

export async function updateAsset(assetId: string, fields: Record<string, unknown>) {
  const resp = await fetch(`${API}/assets/${assetId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
  return resp.json();
}

export async function deleteAsset(assetId: string) {
  const resp = await fetch(`${API}/assets/${assetId}`, { method: 'DELETE' });
  return resp.json();
}

export async function getAssetVariants(assetId: string) {
  const resp = await fetch(`${API}/assets/${assetId}/variants`);
  return resp.json();
}

export async function createAssetVariant(assetId: string, data: Record<string, unknown>) {
  const resp = await fetch(`${API}/assets/${assetId}/variants`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return resp.json();
}

export async function confirmAssets(projectId: string) {
  const resp = await fetch(`${API}/${projectId}/confirm-assets`, { method: 'POST' });
  return resp.json();
}

export async function uploadAssetImage(assetId: string, file: File) {
  const formData = new FormData();
  formData.append('image', file);
  const resp = await fetch(`${API}/assets/${assetId}/upload-image`, { method: 'POST', body: formData });
  return resp.json();
}

export async function generateAssetImages(assetId: string, sessionId: string, style?: string) {
  const resp = await fetch(`${API}/assets/${assetId}/generate-images`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, style }),
  });
  return resp.json();
}

export async function buildSegments(projectId: string) {
  const resp = await fetch(`${API}/${projectId}/build-segments`, { method: 'POST' });
  return resp.json();
}

export async function getSegments(projectId: string) {
  const resp = await fetch(`${API}/${projectId}/segments`);
  return resp.json();
}

export async function generateMusic(projectId: string) {
  const resp = await fetch(`${API}/${projectId}/generate-music`, { method: 'POST' });
  return resp.json();
}

export async function uploadSegmentMusic(projectId: string, segmentId: string, file: File) {
  const formData = new FormData();
  formData.append('music', file);
  const resp = await fetch(`${API}/${projectId}/segments/${segmentId}/upload-music`, { method: 'POST', body: formData });
  return resp.json();
}

export async function configureSuno(apiKey: string, baseUrl?: string) {
  const resp = await fetch(`${API}/music/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey, baseUrl }),
  });
  return resp.json();
}

export async function getMusicConfig() {
  const resp = await fetch(`${API}/music/config`);
  return resp.json();
}

export async function listVoices(language = 'en') {
  const resp = await fetch(`${API}/voices/list?language=${language}`);
  return resp.json();
}

export async function configureDoubaoTTS(appId: string, accessToken: string, clusterId?: string) {
  const resp = await fetch(`${API}/voices/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appId, accessToken, clusterId }),
  });
  return resp.json();
}

export async function getVoiceConfig() {
  const resp = await fetch(`${API}/voices/config`);
  return resp.json();
}

export async function createVoiceBinding(projectId: string, data: Record<string, unknown>) {
  const resp = await fetch(`${API}/${projectId}/voice-bindings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return resp.json();
}

export async function getVoiceBindings(projectId: string) {
  const resp = await fetch(`${API}/${projectId}/voice-bindings`);
  return resp.json();
}

export async function updateVoiceBinding(bindingId: string, fields: Record<string, unknown>) {
  const resp = await fetch(`${API}/voice-bindings/${bindingId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
  return resp.json();
}

export async function deleteVoiceBinding(bindingId: string) {
  const resp = await fetch(`${API}/voice-bindings/${bindingId}`, { method: 'DELETE' });
  return resp.json();
}

export async function generateVoices(projectId: string) {
  const resp = await fetch(`${API}/${projectId}/generate-voices`, { method: 'POST' });
  return resp.json();
}

export async function generateVideos(projectId: string, sessionId: string) {
  const resp = await fetch(`${API}/${projectId}/generate-videos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId }),
  });
  return resp.json();
}

export async function runQualityCheck(projectId: string) {
  const resp = await fetch(`${API}/${projectId}/quality-check`, { method: 'POST' });
  return resp.json();
}

export async function getEpisodes(projectId: string) {
  const resp = await fetch(`${API}/${projectId}/episodes`);
  return resp.json();
}

export async function getRunningTasks() {
  const resp = await fetch(`${API}/tasks/running`);
  return resp.json();
}

export async function getProjectTasks(projectId: string) {
  const resp = await fetch(`${API}/${projectId}/tasks`);
  return resp.json();
}

export async function stopProjectTask(projectId: string, stage?: string) {
  const resp = await fetch(`${API}/${projectId}/stop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stage }),
  });
  return resp.json();
}

export async function composeProject(projectId: string) {
  const resp = await fetch(`${API}/${projectId}/compose`, { method: 'POST' });
  return resp.json();
}

export async function getComposedStatus(projectId: string) {
  const resp = await fetch(`${API}/${projectId}/composed`);
  return resp.json();
}
