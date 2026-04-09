// 短剧制片模块 - 数据库操作层
import { getDB, saveDB } from '../db-service.js';

export function initProductionTables(): void {
  const db = getDB();

  db.run(`CREATE TABLE IF NOT EXISTS production_projects (
    id TEXT PRIMARY KEY,
    title TEXT DEFAULT '',
    status TEXT DEFAULT 'created',
    total_episodes INTEGER DEFAULT 0,
    production_config TEXT DEFAULT '{}',
    requirements_text TEXT DEFAULT '',
    created_at INTEGER,
    updated_at INTEGER
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS production_episodes (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    episode_number INTEGER NOT NULL,
    raw_script TEXT DEFAULT '',
    cleaned_script TEXT DEFAULT '',
    shots_data TEXT DEFAULT '[]',
    status TEXT DEFAULT 'raw',
    video_url TEXT DEFAULT '',
    composed_url TEXT DEFAULT '',
    created_at INTEGER,
    updated_at INTEGER
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS production_assets (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    asset_type TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    visual_prompt TEXT DEFAULT '',
    metadata TEXT DEFAULT '{}',
    image_urls TEXT DEFAULT '[]',
    profile_images TEXT DEFAULT '{}',
    voice_profile_id TEXT DEFAULT '',
    version INTEGER DEFAULT 1,
    status TEXT DEFAULT 'extracted',
    created_at INTEGER,
    updated_at INTEGER
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS asset_variants (
    id TEXT PRIMARY KEY,
    asset_id TEXT NOT NULL,
    episode_number INTEGER NOT NULL,
    variant_label TEXT DEFAULT '',
    description TEXT DEFAULT '',
    visual_prompt TEXT DEFAULT '',
    image_urls TEXT DEFAULT '[]',
    metadata_override TEXT DEFAULT '{}',
    created_at INTEGER
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS voice_profiles (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    character_asset_id TEXT DEFAULT '',
    provider TEXT DEFAULT 'doubao',
    voice_id TEXT DEFAULT '',
    voice_name TEXT DEFAULT '',
    language TEXT DEFAULT 'en',
    speed REAL DEFAULT 1.0,
    pitch REAL DEFAULT 0,
    emotion TEXT DEFAULT '',
    sample_audio_url TEXT DEFAULT '',
    created_at INTEGER
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS tts_config (
    provider TEXT PRIMARY KEY,
    app_id TEXT DEFAULT '',
    access_token TEXT DEFAULT '',
    cluster_id TEXT DEFAULT '',
    extra_json TEXT DEFAULT '{}',
    updated_at INTEGER
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS production_segments (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    episode_id TEXT NOT NULL,
    segment_index INTEGER NOT NULL,
    shot_ids TEXT DEFAULT '[]',
    total_duration REAL DEFAULT 0,
    merged_prompt TEXT DEFAULT '',
    transition_hint TEXT DEFAULT '',
    video_url TEXT DEFAULT '',
    music_url TEXT DEFAULT '',
    video_status TEXT DEFAULT 'pending',
    music_status TEXT DEFAULT 'pending',
    composed_url TEXT DEFAULT '',
    created_at INTEGER
  )`)

  const segColCheck = db.exec("PRAGMA table_info(production_segments)");
  const segCols = segColCheck[0]?.values?.map(v => v[1]) || [];
  if (!segCols.includes('composed_url')) {
    db.run("ALTER TABLE production_segments ADD COLUMN composed_url TEXT DEFAULT ''");
  };

  db.run(`CREATE TABLE IF NOT EXISTS music_config (
    provider TEXT PRIMARY KEY,
    api_key TEXT DEFAULT '',
    base_url TEXT DEFAULT '',
    extra_json TEXT DEFAULT '{}',
    updated_at INTEGER
  )`);

  saveDB();
  console.log('[production-db] 制片模块数据表已初始化');
}

// ==================== 项目 CRUD ====================

export function insertProductionProject(project: {
  id: string; title: string; status: string; totalEpisodes: number;
  config: string; requirementsText: string;
}): void {
  const db = getDB();
  const now = Date.now();
  db.run(
    `INSERT INTO production_projects (id, title, status, total_episodes, production_config, requirements_text, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [project.id, project.title, project.status, project.totalEpisodes, project.config, project.requirementsText, now, now]
  );
  saveDB();
}

export function getProductionProject(id: string) {
  const db = getDB();
  const rows = db.exec(`SELECT * FROM production_projects WHERE id = ?`, [id]);
  if (!rows.length || !rows[0].values.length) return null;
  return rowToProject(rows[0].columns, rows[0].values[0]);
}

export function listProductionProjects() {
  const db = getDB();
  const rows = db.exec(`SELECT * FROM production_projects ORDER BY updated_at DESC`);
  if (!rows.length) return [];
  return rows[0].values.map(v => rowToProject(rows[0].columns, v));
}

export function updateProductionProject(id: string, fields: Record<string, unknown>): void {
  const db = getDB();
  const sets: string[] = [];
  const vals: (string | number | null)[] = [];
  for (const [k, v] of Object.entries(fields)) {
    const col = k.replace(/([A-Z])/g, '_$1').toLowerCase();
    sets.push(`${col} = ?`);
    vals.push(v as string | number | null);
  }
  sets.push('updated_at = ?');
  vals.push(Date.now());
  vals.push(id);
  db.run(`UPDATE production_projects SET ${sets.join(', ')} WHERE id = ?`, vals);
  saveDB();
}

export function deleteProductionProject(id: string): void {
  const db = getDB();
  db.run(`DELETE FROM voice_profiles WHERE project_id = ?`, [id]);
  db.run(`DELETE FROM asset_variants WHERE asset_id IN (SELECT id FROM production_assets WHERE project_id = ?)`, [id]);
  db.run(`DELETE FROM production_assets WHERE project_id = ?`, [id]);
  db.run(`DELETE FROM production_episodes WHERE project_id = ?`, [id]);
  db.run(`DELETE FROM production_projects WHERE id = ?`, [id]);
  saveDB();
}

function rowToProject(cols: string[], vals: unknown[]) {
  const obj: Record<string, unknown> = {};
  cols.forEach((c, i) => obj[c] = vals[i]);
  return {
    id: obj.id as string,
    title: obj.title as string,
    status: obj.status as string,
    totalEpisodes: obj.total_episodes as number,
    config: JSON.parse((obj.production_config as string) || '{}'),
    requirementsText: obj.requirements_text as string,
    createdAt: obj.created_at as number,
    updatedAt: obj.updated_at as number,
  };
}

// ==================== 剧集 CRUD ====================

export function insertProductionEpisode(ep: {
  id: string; projectId: string; episodeNumber: number;
  rawScript: string; status: string;
}): void {
  const db = getDB();
  const now = Date.now();
  db.run(
    `INSERT INTO production_episodes (id, project_id, episode_number, raw_script, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [ep.id, ep.projectId, ep.episodeNumber, ep.rawScript, ep.status, now, now]
  );
  saveDB();
}

export function getProductionEpisodes(projectId: string) {
  const db = getDB();
  const rows = db.exec(`SELECT * FROM production_episodes WHERE project_id = ? ORDER BY episode_number`, [projectId]);
  if (!rows.length) return [];
  return rows[0].values.map(v => rowToEpisode(rows[0].columns, v));
}

export function getProductionEpisode(id: string) {
  const db = getDB();
  const rows = db.exec(`SELECT * FROM production_episodes WHERE id = ?`, [id]);
  if (!rows.length || !rows[0].values.length) return null;
  return rowToEpisode(rows[0].columns, rows[0].values[0]);
}

export function updateProductionEpisode(id: string, fields: Record<string, unknown>): void {
  const db = getDB();
  const sets: string[] = [];
  const vals: (string | number | null)[] = [];
  for (const [k, v] of Object.entries(fields)) {
    const col = k === 'shotsData' ? 'shots_data' : k.replace(/([A-Z])/g, '_$1').toLowerCase();
    sets.push(`${col} = ?`);
    vals.push(typeof v === 'object' ? JSON.stringify(v) : v as string | number | null);
  }
  sets.push('updated_at = ?');
  vals.push(Date.now());
  vals.push(id);
  db.run(`UPDATE production_episodes SET ${sets.join(', ')} WHERE id = ?`, vals);
  saveDB();
}

function rowToEpisode(cols: string[], vals: unknown[]) {
  const obj: Record<string, unknown> = {};
  cols.forEach((c, i) => obj[c] = vals[i]);
  return {
    id: obj.id as string,
    projectId: obj.project_id as string,
    episodeNumber: obj.episode_number as number,
    rawScript: obj.raw_script as string,
    cleanedScript: obj.cleaned_script as string,
    shots: JSON.parse((obj.shots_data as string) || '[]'),
    status: obj.status as string,
    videoUrl: obj.video_url as string,
    composedUrl: obj.composed_url as string,
    createdAt: obj.created_at as number,
    updatedAt: obj.updated_at as number,
  };
}

// ==================== 资产 CRUD ====================

export function insertProductionAsset(asset: {
  id: string; projectId: string; assetType: string; name: string;
  description: string; visualPrompt: string; metadata: string;
  imageUrls: string; status: string;
}): void {
  const db = getDB();
  const now = Date.now();
  db.run(
    `INSERT INTO production_assets (id, project_id, asset_type, name, description, visual_prompt, metadata, image_urls, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [asset.id, asset.projectId, asset.assetType, asset.name, asset.description, asset.visualPrompt, asset.metadata, asset.imageUrls, asset.status, now, now]
  );
  saveDB();
}

export function getProductionAssets(projectId: string, assetType?: string) {
  const db = getDB();
  let sql = `SELECT * FROM production_assets WHERE project_id = ?`;
  const params: (string | number | null)[] = [projectId];
  if (assetType) { sql += ` AND asset_type = ?`; params.push(assetType); }
  sql += ` ORDER BY created_at`;
  const rows = db.exec(sql, params);
  if (!rows.length) return [];
  return rows[0].values.map(v => rowToAsset(rows[0].columns, v));
}

export function getProductionAsset(id: string) {
  const db = getDB();
  const rows = db.exec(`SELECT * FROM production_assets WHERE id = ?`, [id]);
  if (!rows.length || !rows[0].values.length) return null;
  return rowToAsset(rows[0].columns, rows[0].values[0]);
}

export function updateProductionAsset(id: string, fields: Record<string, unknown>): void {
  const db = getDB();
  const sets: string[] = [];
  const vals: (string | number | null)[] = [];
  for (const [k, v] of Object.entries(fields)) {
    const col = k === 'imageUrls' ? 'image_urls'
      : k === 'profileImages' ? 'profile_images'
      : k === 'visualPrompt' ? 'visual_prompt'
      : k === 'voiceProfileId' ? 'voice_profile_id'
      : k === 'assetType' ? 'asset_type'
      : k;
    sets.push(`${col} = ?`);
    vals.push(typeof v === 'object' ? JSON.stringify(v) : v as string | number | null);
  }
  sets.push('updated_at = ?');
  vals.push(Date.now());
  vals.push(id);
  db.run(`UPDATE production_assets SET ${sets.join(', ')} WHERE id = ?`, vals);
  saveDB();
}

export function deleteProductionAsset(id: string): void {
  const db = getDB();
  db.run(`DELETE FROM asset_variants WHERE asset_id = ?`, [id]);
  db.run(`DELETE FROM production_assets WHERE id = ?`, [id]);
  saveDB();
}

function rowToAsset(cols: string[], vals: unknown[]) {
  const obj: Record<string, unknown> = {};
  cols.forEach((c, i) => obj[c] = vals[i]);
  return {
    id: obj.id as string,
    projectId: obj.project_id as string,
    assetType: obj.asset_type as string,
    name: obj.name as string,
    description: obj.description as string,
    visualPrompt: obj.visual_prompt as string,
    metadata: JSON.parse((obj.metadata as string) || '{}'),
    imageUrls: JSON.parse((obj.image_urls as string) || '[]'),
    profileImages: JSON.parse((obj.profile_images as string) || '{}'),
    voiceProfileId: obj.voice_profile_id as string,
    version: obj.version as number,
    status: obj.status as string,
    createdAt: obj.created_at as number,
    updatedAt: obj.updated_at as number,
  };
}

// ==================== 资产变体 ====================

export function insertAssetVariant(v: {
  id: string; assetId: string; episodeNumber: number; variantLabel: string;
  description: string; visualPrompt: string; imageUrls: string; metadataOverride: string;
}): void {
  const db = getDB();
  db.run(
    `INSERT INTO asset_variants (id, asset_id, episode_number, variant_label, description, visual_prompt, image_urls, metadata_override, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [v.id, v.assetId, v.episodeNumber, v.variantLabel, v.description, v.visualPrompt, v.imageUrls, v.metadataOverride, Date.now()]
  );
  saveDB();
}

export function getAssetVariants(assetId: string) {
  const db = getDB();
  const rows = db.exec(`SELECT * FROM asset_variants WHERE asset_id = ? ORDER BY episode_number`, [assetId]);
  if (!rows.length) return [];
  return rows[0].values.map(v => {
    const obj: Record<string, unknown> = {};
    rows[0].columns.forEach((c, i) => obj[c] = v[i]);
    return {
      id: obj.id as string,
      assetId: obj.asset_id as string,
      episodeNumber: obj.episode_number as number,
      variantLabel: obj.variant_label as string,
      description: obj.description as string,
      visualPrompt: obj.visual_prompt as string,
      imageUrls: JSON.parse((obj.image_urls as string) || '[]'),
      metadataOverride: JSON.parse((obj.metadata_override as string) || '{}'),
      createdAt: obj.created_at as number,
    };
  });
}

// ==================== 语音配置 ====================

export function insertVoiceProfile(vp: {
  id: string; projectId: string; characterAssetId: string;
  provider: string; voiceId: string; voiceName: string;
  language: string; speed: number; pitch: number; emotion: string;
}): void {
  const db = getDB();
  db.run(
    `INSERT INTO voice_profiles (id, project_id, character_asset_id, provider, voice_id, voice_name, language, speed, pitch, emotion, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [vp.id, vp.projectId, vp.characterAssetId, vp.provider, vp.voiceId, vp.voiceName, vp.language, vp.speed, vp.pitch, vp.emotion, Date.now()]
  );
  saveDB();
}

export function getVoiceProfiles(projectId: string) {
  const db = getDB();
  const rows = db.exec(`SELECT * FROM voice_profiles WHERE project_id = ? ORDER BY created_at`, [projectId]);
  if (!rows.length) return [];
  return rows[0].values.map(v => {
    const obj: Record<string, unknown> = {};
    rows[0].columns.forEach((c, i) => obj[c] = v[i]);
    return {
      id: obj.id as string,
      projectId: obj.project_id as string,
      characterAssetId: obj.character_asset_id as string,
      provider: obj.provider as string,
      voiceId: obj.voice_id as string,
      voiceName: obj.voice_name as string,
      language: obj.language as string,
      speed: obj.speed as number,
      pitch: obj.pitch as number,
      emotion: obj.emotion as string,
      sampleAudioUrl: obj.sample_audio_url as string,
      createdAt: obj.created_at as number,
    };
  });
}

export function updateVoiceProfile(id: string, fields: Record<string, unknown>): void {
  const db = getDB();
  const sets: string[] = [];
  const vals: (string | number | null)[] = [];
  for (const [k, v] of Object.entries(fields)) {
    const col = k === 'voiceId' ? 'voice_id'
      : k === 'voiceName' ? 'voice_name'
      : k === 'characterAssetId' ? 'character_asset_id'
      : k === 'sampleAudioUrl' ? 'sample_audio_url'
      : k;
    sets.push(`${col} = ?`);
    vals.push(v as string | number | null);
  }
  vals.push(id);
  db.run(`UPDATE voice_profiles SET ${sets.join(', ')} WHERE id = ?`, vals);
  saveDB();
}

export function deleteVoiceProfile(id: string): void {
  const db = getDB();
  db.run(`DELETE FROM voice_profiles WHERE id = ?`, [id]);
  saveDB();
}

// ==================== TTS Config ====================

export function saveTTSConfig(provider: string, appId: string, accessToken: string, clusterId: string, extra?: Record<string, unknown>): void {
  const db = getDB();
  db.run(
    `INSERT OR REPLACE INTO tts_config (provider, app_id, access_token, cluster_id, extra_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [provider, appId, accessToken, clusterId, JSON.stringify(extra || {}), Date.now()]
  );
  saveDB();
}

export function loadTTSConfig(provider: string): { appId: string; accessToken: string; clusterId: string; extra: Record<string, unknown> } | null {
  const db = getDB();
  const rows = db.exec(`SELECT * FROM tts_config WHERE provider = ?`, [provider]);
  if (!rows.length || !rows[0].values.length) return null;
  const obj: Record<string, unknown> = {};
  rows[0].columns.forEach((c, i) => obj[c] = rows[0].values[0][i]);
  return {
    appId: obj.app_id as string,
    accessToken: obj.access_token as string,
    clusterId: obj.cluster_id as string,
    extra: JSON.parse((obj.extra_json as string) || '{}'),
  };
}

// ==================== Segments ====================

export function insertSegment(seg: {
  id: string; projectId: string; episodeId: string; segmentIndex: number;
  shotIds: string; totalDuration: number; mergedPrompt: string; transitionHint: string;
}): void {
  const db = getDB();
  db.run(
    `INSERT INTO production_segments (id, project_id, episode_id, segment_index, shot_ids, total_duration, merged_prompt, transition_hint, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [seg.id, seg.projectId, seg.episodeId, seg.segmentIndex, seg.shotIds, seg.totalDuration, seg.mergedPrompt, seg.transitionHint, Date.now()]
  );
  saveDB();
}

export function getSegments(projectId: string, episodeId?: string) {
  const db = getDB();
  let sql = `SELECT * FROM production_segments WHERE project_id = ?`;
  const params: (string | number | null)[] = [projectId];
  if (episodeId) { sql += ` AND episode_id = ?`; params.push(episodeId); }
  sql += ` ORDER BY episode_id, segment_index`;
  const rows = db.exec(sql, params);
  if (!rows.length) return [];
  return rows[0].values.map(v => {
    const obj: Record<string, unknown> = {};
    rows[0].columns.forEach((c, i) => obj[c] = v[i]);
    return {
      id: obj.id as string,
      projectId: obj.project_id as string,
      episodeId: obj.episode_id as string,
      segmentIndex: obj.segment_index as number,
      shotIds: JSON.parse((obj.shot_ids as string) || '[]'),
      totalDuration: obj.total_duration as number,
      mergedPrompt: obj.merged_prompt as string,
      transitionHint: obj.transition_hint as string,
      videoUrl: obj.video_url as string,
      musicUrl: obj.music_url as string,
      videoStatus: obj.video_status as string,
      musicStatus: obj.music_status as string,
      composedUrl: (obj.composed_url as string) || '',
      createdAt: obj.created_at as number,
    };
  });
}

export function updateSegment(id: string, fields: Record<string, unknown>): void {
  const db = getDB();
  const sets: string[] = [];
  const vals: (string | number | null)[] = [];
  for (const [k, v] of Object.entries(fields)) {
    const col = k === 'videoUrl' ? 'video_url'
      : k === 'musicUrl' ? 'music_url'
      : k === 'videoStatus' ? 'video_status'
      : k === 'musicStatus' ? 'music_status'
      : k === 'composedUrl' ? 'composed_url'
      : k === 'mergedPrompt' ? 'merged_prompt'
      : k === 'shotIds' ? 'shot_ids'
      : k === 'totalDuration' ? 'total_duration'
      : k === 'transitionHint' ? 'transition_hint'
      : k;
    sets.push(`${col} = ?`);
    vals.push(typeof v === 'object' ? JSON.stringify(v) : v as string | number | null);
  }
  vals.push(id);
  db.run(`UPDATE production_segments SET ${sets.join(', ')} WHERE id = ?`, vals);
  saveDB();
}

export function deleteSegmentsByProject(projectId: string): void {
  const db = getDB();
  db.run(`DELETE FROM production_segments WHERE project_id = ?`, [projectId]);
  saveDB();
}

export function deleteSegmentsByEpisode(episodeId: string): void {
  const db = getDB();
  db.run(`DELETE FROM production_segments WHERE episode_id = ?`, [episodeId]);
  saveDB();
}

// ==================== Music Config ====================

export function saveMusicConfig(provider: string, apiKey: string, baseUrl: string): void {
  const db = getDB();
  db.run(
    `INSERT OR REPLACE INTO music_config (provider, api_key, base_url, updated_at) VALUES (?, ?, ?, ?)`,
    [provider, apiKey, baseUrl, Date.now()]
  );
  saveDB();
}

export function loadMusicConfig(provider: string): { apiKey: string; baseUrl: string } | null {
  const db = getDB();
  const rows = db.exec(`SELECT * FROM music_config WHERE provider = ?`, [provider]);
  if (!rows.length || !rows[0].values.length) return null;
  const obj: Record<string, unknown> = {};
  rows[0].columns.forEach((c, i) => obj[c] = rows[0].values[0][i]);
  return { apiKey: obj.api_key as string, baseUrl: obj.base_url as string };
}
