// SQLite 数据库服务 - 使用 sql.js (纯 JS，无需原生编译)
// 持久化存储短剧项目、角色、场景、LLM 调用日志
import initSqlJs, { type Database } from 'sql.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../data');
const DB_FILE = path.join(DATA_DIR, 'drama.db');

let db: Database | null = null;

// 初始化数据库
export async function initDB(): Promise<void> {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  const SQL = await initSqlJs();

  if (fs.existsSync(DB_FILE)) {
    const buffer = fs.readFileSync(DB_FILE);
    db = new SQL.Database(buffer);
    console.log('[db] 已加载数据库');
  } else {
    db = new SQL.Database();
    console.log('[db] 已创建新数据库');
  }

  // 建表
  db.run(`CREATE TABLE IF NOT EXISTS drama_projects (
    id TEXT PRIMARY KEY,
    title TEXT DEFAULT '',
    status TEXT DEFAULT 'analyzing',
    target_episodes INTEGER DEFAULT 20,
    style TEXT DEFAULT '',
    ratio TEXT DEFAULT '16:9',
    episode_duration INTEGER DEFAULT 15,
    novel_data TEXT DEFAULT '{}',
    episodes_data TEXT DEFAULT '[]',
    created_at INTEGER,
    updated_at INTEGER
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS llm_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT,
    step TEXT,
    provider TEXT,
    model TEXT,
    prompt_tokens INTEGER DEFAULT 0,
    completion_tokens INTEGER DEFAULT 0,
    duration_ms INTEGER DEFAULT 0,
    success INTEGER DEFAULT 1,
    error TEXT,
    created_at INTEGER
  )`);

  // 创作工厂项目表
  db.run(`CREATE TABLE IF NOT EXISTS factory_projects (
    id TEXT PRIMARY KEY,
    status TEXT DEFAULT 'init',
    novel_text TEXT DEFAULT '',
    novel_dna TEXT,
    chapters TEXT DEFAULT '[]',
    stages TEXT DEFAULT '[]',
    agents TEXT DEFAULT '[]',
    current_chapter INTEGER DEFAULT 0,
    current_generation INTEGER DEFAULT 0,
    evolution_history TEXT DEFAULT '[]',
    final_agent TEXT,
    concurrency INTEGER DEFAULT 5,
    agents_per_generation INTEGER DEFAULT 100,
    top_k INTEGER DEFAULT 10,
    created_at INTEGER,
    updated_at INTEGER,
    error TEXT
  )`);

  // 迁移：为旧数据库添加 stages 列
  try { db.run(`ALTER TABLE factory_projects ADD COLUMN stages TEXT DEFAULT '[]'`); } catch { /* 列已存在则忽略 */ }

  // Agent仓库表
  db.run(`CREATE TABLE IF NOT EXISTS agent_store (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    genre TEXT DEFAULT '',
    tone TEXT DEFAULT '',
    description TEXT DEFAULT '',
    system_prompt TEXT NOT NULL,
    style_directive TEXT DEFAULT '',
    technique_weights TEXT DEFAULT '{}',
    source_novel TEXT DEFAULT '',
    score REAL DEFAULT 0,
    generation INTEGER DEFAULT 0,
    score_history TEXT DEFAULT '[]',
    mutation_log TEXT DEFAULT '[]',
    factory_project_id TEXT,
    created_at INTEGER,
    updated_at INTEGER
  )`);

  // 角色Agent仓库表（从小说转漫剧提取的角色，转为可复用的群演Agent）
  db.run(`CREATE TABLE IF NOT EXISTS character_agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT DEFAULT 'supporting',
    source_novel TEXT DEFAULT '',
    source_project_id TEXT,
    category TEXT DEFAULT '',
    description TEXT DEFAULT '',
    personality TEXT DEFAULT '',
    visual_prompt TEXT DEFAULT '',
    costume_desc TEXT DEFAULT '',
    system_prompt TEXT NOT NULL,
    profile_images TEXT DEFAULT '{}',
    tags TEXT DEFAULT '[]',
    created_at INTEGER,
    updated_at INTEGER
  )`);

  // 剧本项目表
  db.run(`CREATE TABLE IF NOT EXISTS screenplay_projects (
    id TEXT PRIMARY KEY,
    status TEXT DEFAULT 'init',
    config TEXT DEFAULT '{}',
    data TEXT DEFAULT '{}',
    created_at INTEGER,
    updated_at INTEGER
  )`);

  // 角斗场 ELO 积分表
  db.run(`CREATE TABLE IF NOT EXISTS arena_elo (
    screenplay_id TEXT PRIMARY KEY,
    elo INTEGER DEFAULT 1200,
    wins INTEGER DEFAULT 0,
    losses INTEGER DEFAULT 0,
    draws INTEGER DEFAULT 0,
    updated_at INTEGER
  )`);

  // 角斗场评分记录表
  db.run(`CREATE TABLE IF NOT EXISTS arena_scores (
    id TEXT PRIMARY KEY,
    screenplay_id TEXT NOT NULL,
    mode TEXT NOT NULL,
    role_scores TEXT NOT NULL,
    final_score TEXT NOT NULL,
    skipped_roles TEXT DEFAULT '[]',
    created_at INTEGER
  )`);

  // 角斗场对战记录表
  db.run(`CREATE TABLE IF NOT EXISTS arena_battles (
    id TEXT PRIMARY KEY,
    screenplay_id_a TEXT NOT NULL,
    screenplay_id_b TEXT NOT NULL,
    dimension_results TEXT NOT NULL,
    final_verdict TEXT NOT NULL,
    improvement_suggestions TEXT,
    elo_change_a INTEGER NOT NULL,
    elo_change_b INTEGER NOT NULL,
    created_at INTEGER
  )`);

  // 角斗场锦标赛表
  db.run(`CREATE TABLE IF NOT EXISTS arena_tournaments (
    id TEXT PRIMARY KEY,
    format TEXT NOT NULL,
    screenplay_ids TEXT NOT NULL,
    bracket TEXT NOT NULL,
    results TEXT DEFAULT '{}',
    champion_id TEXT,
    status TEXT DEFAULT 'pending',
    created_at INTEGER,
    completed_at INTEGER
  )`);

  // 角斗场进化记录表
  db.run(`CREATE TABLE IF NOT EXISTS arena_evolutions (
    id TEXT PRIMARY KEY,
    source_screenplay_id TEXT NOT NULL,
    target_screenplay_id TEXT NOT NULL,
    winner_screenplay_id TEXT NOT NULL,
    battle_id TEXT NOT NULL,
    absorbed_elements TEXT NOT NULL,
    evolution_type TEXT NOT NULL,
    generation INTEGER DEFAULT 1,
    created_at INTEGER
  )`);

  // ============ 百Agent竞技模式表 ============

  // 竞技会话表
  db.run(`CREATE TABLE IF NOT EXISTS arena_sessions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    config TEXT NOT NULL,
    status TEXT DEFAULT 'init',
    current_stage TEXT,
    task_id TEXT NOT NULL,
    created_at INTEGER,
    completed_at INTEGER
  )`);

  // 创作Agent表（含系统Agent组长信息）
  db.run(`CREATE TABLE IF NOT EXISTS arena_writers (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    group_id TEXT NOT NULL,
    name TEXT NOT NULL,
    is_leader INTEGER DEFAULT 0,
    system_agent_id TEXT NOT NULL,
    system_agent_name TEXT NOT NULL,
    base_style_id TEXT,
    style_gene TEXT NOT NULL,
    system_prompt TEXT NOT NULL,
    created_at INTEGER
  )`);

  // 评审Agent表
  db.run(`CREATE TABLE IF NOT EXISTS arena_reviewers (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    direction_id TEXT NOT NULL,
    direction_name TEXT NOT NULL,
    system_prompt TEXT NOT NULL,
    weight REAL NOT NULL,
    created_at INTEGER
  )`);

  // 候选产出表（含风格溯源字段）
  db.run(`CREATE TABLE IF NOT EXISTS arena_candidates (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    stage TEXT NOT NULL,
    writer_id TEXT NOT NULL,
    group_id TEXT NOT NULL,
    system_agent_id TEXT NOT NULL,
    system_agent_name TEXT NOT NULL,
    parent_candidate_id TEXT,
    content TEXT NOT NULL,
    character_pool_ids TEXT,
    created_at INTEGER
  )`);

  // 评审记录表
  db.run(`CREATE TABLE IF NOT EXISTS arena_reviews (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    candidate_id TEXT NOT NULL,
    reviewer_id TEXT NOT NULL,
    direction_id TEXT NOT NULL,
    stage TEXT NOT NULL,
    score REAL NOT NULL,
    comments TEXT NOT NULL,
    created_at INTEGER
  )`);

  // 竞技候选综合评分表（区别于角斗场的 arena_scores）
  db.run(`CREATE TABLE IF NOT EXISTS arena_funnel_scores (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    candidate_id TEXT NOT NULL,
    stage TEXT NOT NULL,
    direction_scores TEXT NOT NULL,
    weighted_total REAL NOT NULL,
    rank INTEGER,
    selected INTEGER DEFAULT 0,
    created_at INTEGER
  )`);

  saveDB();
}

// 保存数据库到文件
export function saveDB(): void {
  if (!db) return;
  const data = db.export();
  fs.writeFileSync(DB_FILE, Buffer.from(data));
}

// 获取数据库实例
export function getDB(): Database {
  if (!db) throw new Error('数据库未初始化，请先调用 initDB()');
  return db;
}

// ============================================================
// 短剧项目 CRUD
// ============================================================

export interface DramaProjectRow {
  id: string;
  title: string;
  status: string;
  target_episodes: number;
  style: string;
  ratio: string;
  episode_duration: number;
  novel_data: string; // JSON string
  episodes_data: string; // JSON string
  created_at: number;
  updated_at: number;
}

export function insertProject(project: DramaProjectRow): void {
  const d = getDB();
  d.run(
    `INSERT INTO drama_projects (id, title, status, target_episodes, style, ratio, episode_duration, novel_data, episodes_data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [project.id, project.title, project.status, project.target_episodes, project.style,
     project.ratio, project.episode_duration, project.novel_data, project.episodes_data,
     project.created_at, project.updated_at],
  );
  saveDB();
}

export function getProjectById(id: string): DramaProjectRow | null {
  const d = getDB();
  const stmt = d.prepare('SELECT * FROM drama_projects WHERE id = ?');
  stmt.bind([id]);
  if (stmt.step()) {
    const row = stmt.getAsObject() as unknown as DramaProjectRow;
    stmt.free();
    return row;
  }
  stmt.free();
  return null;
}

export function updateProjectFields(id: string, fields: Partial<DramaProjectRow>): void {
  const d = getDB();
  const sets: string[] = [];
  const values: (string | number | null)[] = [];
  for (const [key, val] of Object.entries(fields)) {
    if (key === 'id') continue;
    sets.push(`${key} = ?`);
    values.push(val as string | number | null);
  }
  if (sets.length === 0) return;
  sets.push('updated_at = ?');
  values.push(Date.now());
  values.push(id);
  d.run(`UPDATE drama_projects SET ${sets.join(', ')} WHERE id = ?`, values);
  saveDB();
}

export function listAllProjects(): DramaProjectRow[] {
  const d = getDB();
  const results: DramaProjectRow[] = [];
  const stmt = d.prepare('SELECT * FROM drama_projects ORDER BY created_at DESC');
  while (stmt.step()) {
    results.push(stmt.getAsObject() as unknown as DramaProjectRow);
  }
  stmt.free();
  return results;
}

export function deleteProject(id: string): void {
  const d = getDB();
  d.run('DELETE FROM drama_projects WHERE id = ?', [id]);
  d.run('DELETE FROM llm_logs WHERE project_id = ?', [id]);
  saveDB();
}

// ============================================================
// LLM 调用日志
// ============================================================

export function logLLMCall(entry: {
  projectId: string;
  step: string;
  provider: string;
  model: string;
  durationMs: number;
  success: boolean;
  error?: string;
}): void {
  const d = getDB();
  d.run(
    `INSERT INTO llm_logs (project_id, step, provider, model, duration_ms, success, error, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [entry.projectId, entry.step, entry.provider, entry.model,
     entry.durationMs, entry.success ? 1 : 0, entry.error || null, Date.now()],
  );
  saveDB();
}

export function getProjectLogs(projectId: string): Array<Record<string, unknown>> {
  const d = getDB();
  const results: Array<Record<string, unknown>> = [];
  const stmt = d.prepare('SELECT * FROM llm_logs WHERE project_id = ? ORDER BY created_at DESC');
  stmt.bind([projectId]);
  while (stmt.step()) {
    results.push(stmt.getAsObject() as Record<string, unknown>);
  }
  stmt.free();
  return results;
}


// ============================================================
// LLM 配置持久化
// ============================================================

export function saveLLMConfig(config: Record<string, unknown>): void {
  const d = getDB();
  d.run(`CREATE TABLE IF NOT EXISTS llm_config (
    key TEXT PRIMARY KEY,
    value TEXT
  )`);
  for (const [key, val] of Object.entries(config)) {
    if (val === undefined || val === null) continue;
    d.run('INSERT OR REPLACE INTO llm_config (key, value) VALUES (?, ?)', [key, String(val)]);
  }
  saveDB();
}

export function loadLLMConfigFromDB(): Record<string, string> | null {
  const d = getDB();
  try {
    const stmt = d.prepare("SELECT key, value FROM llm_config WHERE key NOT LIKE 'vision_%'");
    const result: Record<string, string> = {};
    let hasData = false;
    while (stmt.step()) {
      const row = stmt.getAsObject() as { key: string; value: string };
      result[row.key] = row.value;
      hasData = true;
    }
    stmt.free();
    return hasData ? result : null;
  } catch {
    return null;
  }
}

// Vision LLM 配置（AI 图片审查用，带 vision_ 前缀存储）
export function saveVisionLLMConfig(config: Record<string, unknown>): void {
  const d = getDB();
  d.run(`CREATE TABLE IF NOT EXISTS llm_config (
    key TEXT PRIMARY KEY,
    value TEXT
  )`);
  for (const [key, val] of Object.entries(config)) {
    if (val === undefined || val === null) continue;
    d.run('INSERT OR REPLACE INTO llm_config (key, value) VALUES (?, ?)', [`vision_${key}`, String(val)]);
  }
  saveDB();
}
// 额外 LLM 配置池（多 API Key 并发）
export function saveExtraLLMConfigs(configs: Array<Record<string, unknown>>): void {
  const d = getDB();
  d.run(`CREATE TABLE IF NOT EXISTS llm_config (key TEXT PRIMARY KEY, value TEXT)`);
  // 清除旧的 extra_ 配置
  d.run("DELETE FROM llm_config WHERE key LIKE 'extra_%'");
  for (let i = 0; i < configs.length; i++) {
    for (const [key, val] of Object.entries(configs[i])) {
      if (val === undefined || val === null) continue;
      d.run('INSERT OR REPLACE INTO llm_config (key, value) VALUES (?, ?)', [`extra_${i}_${key}`, String(val)]);
    }
  }
  saveDB();
}

export function loadExtraLLMConfigsFromDB(): Array<Record<string, string>> {
  const d = getDB();
  try {
    const stmt = d.prepare("SELECT key, value FROM llm_config WHERE key LIKE 'extra_%'");
    const map = new Map<number, Record<string, string>>();
    while (stmt.step()) {
      const row = stmt.getAsObject() as { key: string; value: string };
      // key format: extra_0_provider, extra_1_apiKey, etc.
      const parts = row.key.split('_');
      const idx = parseInt(parts[1]);
      const field = parts.slice(2).join('_');
      if (!map.has(idx)) map.set(idx, {});
      map.get(idx)![field] = row.value;
    }
    stmt.free();
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0]).map(([, v]) => v);
  } catch {
    return [];
  }
}

// NSFW 全局开关持久化
export function saveNSFWEnabled(enabled: boolean): void {
  const d = getDB();
  d.run('INSERT OR REPLACE INTO llm_config (key, value) VALUES (?, ?)', ['nsfw_enabled', enabled ? '1' : '0']);
  saveDB();
}

export function loadNSFWEnabled(): boolean {
  const d = getDB();
  try {
    const stmt = d.prepare("SELECT value FROM llm_config WHERE key = 'nsfw_enabled'");
    if (stmt.step()) {
      const val = (stmt.getAsObject() as { value: string }).value;
      stmt.free();
      return val === '1';
    }
    stmt.free();
    return false;
  } catch { return false; }
}


export function loadVisionLLMConfigFromDB(): Record<string, string> | null {
  const d = getDB();
  try {
    const stmt = d.prepare("SELECT key, value FROM llm_config WHERE key LIKE 'vision_%'");
    const result: Record<string, string> = {};
    let hasData = false;
    while (stmt.step()) {
      const row = stmt.getAsObject() as { key: string; value: string };
      result[row.key.replace('vision_', '')] = row.value;
      hasData = true;
    }
    stmt.free();
    return hasData ? result : null;
  } catch {
    return null;
  }
}


// ============================================================
// 创作工厂项目持久化
// ============================================================

export interface FactoryProjectRow {
  id: string;
  status: string;
  novel_text: string;
  novel_dna: string | null;
  chapters: string;
  stages: string;
  agents: string;
  current_chapter: number;
  current_generation: number;
  evolution_history: string;
  final_agent: string | null;
  concurrency: number;
  agents_per_generation: number;
  top_k: number;
  created_at: number;
  updated_at: number;
  error: string | null;
}

export function insertFactoryProject(row: FactoryProjectRow): void {
  const d = getDB();
  d.run(
    `INSERT OR REPLACE INTO factory_projects (id, status, novel_text, novel_dna, chapters, stages, agents, current_chapter, current_generation, evolution_history, final_agent, concurrency, agents_per_generation, top_k, created_at, updated_at, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [row.id, row.status, row.novel_text, row.novel_dna, row.chapters, row.stages, row.agents,
     row.current_chapter, row.current_generation, row.evolution_history, row.final_agent,
     row.concurrency, row.agents_per_generation, row.top_k, row.created_at, row.updated_at, row.error],
  );
  saveDB();
}

export function getFactoryProjectById(id: string): FactoryProjectRow | null {
  const d = getDB();
  const stmt = d.prepare('SELECT * FROM factory_projects WHERE id = ?');
  stmt.bind([id]);
  if (stmt.step()) {
    const row = stmt.getAsObject() as unknown as FactoryProjectRow;
    stmt.free();
    return row;
  }
  stmt.free();
  return null;
}

export function listFactoryProjects(): FactoryProjectRow[] {
  const d = getDB();
  const results: FactoryProjectRow[] = [];
  const stmt = d.prepare('SELECT * FROM factory_projects ORDER BY created_at DESC');
  while (stmt.step()) {
    results.push(stmt.getAsObject() as unknown as FactoryProjectRow);
  }
  stmt.free();
  return results;
}

export function deleteFactoryProject(id: string): void {
  const d = getDB();
  d.run('DELETE FROM factory_projects WHERE id = ?', [id]);
  saveDB();
}

// ============================================================
// Agent 仓库
// ============================================================

export interface AgentStoreRow {
  id: string;
  name: string;
  genre: string;
  tone: string;
  description: string;
  system_prompt: string;
  style_directive: string;
  technique_weights: string;
  source_novel: string;
  score: number;
  generation: number;
  score_history: string;
  mutation_log: string;
  factory_project_id: string | null;
  created_at: number;
  updated_at: number;
}

export function insertAgent(row: AgentStoreRow): void {
  const d = getDB();
  d.run(
    `INSERT OR REPLACE INTO agent_store (id, name, genre, tone, description, system_prompt, style_directive, technique_weights, source_novel, score, generation, score_history, mutation_log, factory_project_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [row.id, row.name, row.genre, row.tone, row.description, row.system_prompt, row.style_directive,
     row.technique_weights, row.source_novel, row.score, row.generation, row.score_history, row.mutation_log,
     row.factory_project_id, row.created_at, row.updated_at],
  );
  saveDB();
}

export function listAgents(): AgentStoreRow[] {
  const d = getDB();
  const results: AgentStoreRow[] = [];
  const stmt = d.prepare('SELECT * FROM agent_store ORDER BY created_at DESC');
  while (stmt.step()) {
    results.push(stmt.getAsObject() as unknown as AgentStoreRow);
  }
  stmt.free();
  return results;
}

export function getAgentById(id: string): AgentStoreRow | null {
  const d = getDB();
  const stmt = d.prepare('SELECT * FROM agent_store WHERE id = ?');
  stmt.bind([id]);
  if (stmt.step()) {
    const row = stmt.getAsObject() as unknown as AgentStoreRow;
    stmt.free();
    return row;
  }
  stmt.free();
  return null;
}

export function deleteAgent(id: string): void {
  const d = getDB();
  d.run('DELETE FROM agent_store WHERE id = ?', [id]);
  saveDB();
}

// ============================================================
// 角色Agent仓库（群演库）
// ============================================================

export interface CharacterAgentRow {
  id: string;
  name: string;
  role: string;           // protagonist | supporting | minor
  source_novel: string;
  source_project_id: string | null;
  category: string;       // 分类标签（如：校园、武侠、都市）
  description: string;
  personality: string;
  visual_prompt: string;
  costume_desc: string;
  system_prompt: string;  // 角色扮演Agent提示词
  profile_images: string; // JSON: { main?, front?, side?, back?, costume? }
  tags: string;           // JSON: string[]
  created_at: number;
  updated_at: number;
}

export function insertCharacterAgent(row: CharacterAgentRow): void {
  const d = getDB();
  d.run(
    `INSERT OR REPLACE INTO character_agents (id, name, role, source_novel, source_project_id, category, description, personality, visual_prompt, costume_desc, system_prompt, profile_images, tags, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [row.id, row.name, row.role, row.source_novel, row.source_project_id, row.category,
     row.description, row.personality, row.visual_prompt, row.costume_desc, row.system_prompt,
     row.profile_images, row.tags, row.created_at, row.updated_at],
  );
  saveDB();
}

export function listCharacterAgents(): CharacterAgentRow[] {
  const d = getDB();
  const results: CharacterAgentRow[] = [];
  const stmt = d.prepare('SELECT * FROM character_agents ORDER BY created_at DESC');
  while (stmt.step()) {
    results.push(stmt.getAsObject() as unknown as CharacterAgentRow);
  }
  stmt.free();
  return results;
}

export function getCharacterAgentById(id: string): CharacterAgentRow | null {
  const d = getDB();
  const stmt = d.prepare('SELECT * FROM character_agents WHERE id = ?');
  stmt.bind([id]);
  if (stmt.step()) {
    const row = stmt.getAsObject() as unknown as CharacterAgentRow;
    stmt.free();
    return row;
  }
  stmt.free();
  return null;
}

export function listCharacterAgentsByCategory(category: string): CharacterAgentRow[] {
  const d = getDB();
  const results: CharacterAgentRow[] = [];
  const stmt = d.prepare('SELECT * FROM character_agents WHERE category = ? ORDER BY created_at DESC');
  stmt.bind([category]);
  while (stmt.step()) {
    results.push(stmt.getAsObject() as unknown as CharacterAgentRow);
  }
  stmt.free();
  return results;
}

export function deleteCharacterAgent(id: string): void {
  const d = getDB();
  d.run('DELETE FROM character_agents WHERE id = ?', [id]);
  saveDB();
}

export function updateCharacterAgent(id: string, fields: Partial<Omit<CharacterAgentRow, 'id' | 'created_at'>>): void {
  const d = getDB();
  const sets: string[] = [];
  const vals: (string | number | null)[] = [];
  for (const [key, val] of Object.entries(fields)) {
    sets.push(`${key} = ?`);
    vals.push(val as string | number | null);
  }
  if (sets.length === 0) return;
  vals.push(id);
  d.run(`UPDATE character_agents SET ${sets.join(', ')} WHERE id = ?`, vals);
  saveDB();
}

// ============================================================
// 剧本项目持久化
// ============================================================

export interface ScreenplayProjectRow {
  id: string;
  status: string;
  config: string;   // JSON
  data: string;     // JSON (整个项目数据)
  created_at: number;
  updated_at: number;
}

export function upsertScreenplayProject(row: ScreenplayProjectRow): void {
  const d = getDB();
  d.run(
    `INSERT OR REPLACE INTO screenplay_projects (id, status, config, data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [row.id, row.status, row.config, row.data, row.created_at, row.updated_at],
  );
  saveDB();
}

export function getScreenplayProjectById(id: string): ScreenplayProjectRow | null {
  const d = getDB();
  const stmt = d.prepare('SELECT * FROM screenplay_projects WHERE id = ?');
  stmt.bind([id]);
  if (stmt.step()) {
    const row = stmt.getAsObject() as unknown as ScreenplayProjectRow;
    stmt.free();
    return row;
  }
  stmt.free();
  return null;
}

export function listScreenplayProjects(): ScreenplayProjectRow[] {
  const d = getDB();
  const results: ScreenplayProjectRow[] = [];
  const stmt = d.prepare('SELECT * FROM screenplay_projects ORDER BY updated_at DESC');
  while (stmt.step()) {
    results.push(stmt.getAsObject() as unknown as ScreenplayProjectRow);
  }
  stmt.free();
  return results;
}

export function deleteScreenplayProject(id: string): void {
  const d = getDB();
  d.run('DELETE FROM screenplay_projects WHERE id = ?', [id]);
  saveDB();
}


// ============================================================
// 百Agent竞技模式 — 类型定义
// ============================================================

export interface ArenaSessionRow {
  id: string;
  project_id: string;
  config: string;          // JSON: ArenaConfig
  status: string;          // 'init'|'stage_plan'|'stage_char'|'stage_dir'|'stage_ep'|'completed'|'stopped'
  current_stage: string | null;
  task_id: string;
  created_at: number;
  completed_at: number | null;
}

export interface ArenaWriterRow {
  id: string;
  session_id: string;
  group_id: string;
  name: string;
  is_leader: number;       // 0 or 1 (SQLite boolean)
  system_agent_id: string;
  system_agent_name: string;
  base_style_id: string | null;
  style_gene: string;      // JSON: StyleGene
  system_prompt: string;
  created_at: number;
}

export interface ArenaReviewerRow {
  id: string;
  session_id: string;
  direction_id: string;
  direction_name: string;
  system_prompt: string;
  weight: number;
  created_at: number;
}

export interface ArenaCandidateRow {
  id: string;
  session_id: string;
  stage: string;
  writer_id: string;
  group_id: string;
  system_agent_id: string;
  system_agent_name: string;
  parent_candidate_id: string | null;
  content: string;         // JSON
  character_pool_ids: string | null; // JSON
  created_at: number;
}

export interface ArenaReviewRow {
  id: string;
  session_id: string;
  candidate_id: string;
  reviewer_id: string;
  direction_id: string;
  stage: string;
  score: number;
  comments: string;
  created_at: number;
}

export interface ArenaFunnelScoreRow {
  id: string;
  session_id: string;
  candidate_id: string;
  stage: string;
  direction_scores: string; // JSON: DirectionScore[]
  weighted_total: number;
  rank: number | null;
  selected: number;         // 0 or 1
  created_at: number;
}

// ============================================================
// 百Agent竞技模式 — 竞技会话 CRUD
// ============================================================

export function createArenaSession(row: ArenaSessionRow): void {
  const d = getDB();
  d.run(
    `INSERT INTO arena_sessions (id, project_id, config, status, current_stage, task_id, created_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [row.id, row.project_id, row.config, row.status, row.current_stage,
     row.task_id, row.created_at, row.completed_at],
  );
  saveDB();
}

export function getArenaSession(id: string): ArenaSessionRow | null {
  const d = getDB();
  const stmt = d.prepare('SELECT * FROM arena_sessions WHERE id = ?');
  stmt.bind([id]);
  if (stmt.step()) {
    const row = stmt.getAsObject() as unknown as ArenaSessionRow;
    stmt.free();
    return row;
  }
  stmt.free();
  return null;
}

export function getArenaSessionByProjectId(projectId: string): ArenaSessionRow | null {
  const d = getDB();
  const stmt = d.prepare('SELECT * FROM arena_sessions WHERE project_id = ? ORDER BY created_at DESC LIMIT 1');
  stmt.bind([projectId]);
  if (stmt.step()) {
    const row = stmt.getAsObject() as unknown as ArenaSessionRow;
    stmt.free();
    return row;
  }
  stmt.free();
  return null;
}

export function updateArenaSession(id: string, fields: Partial<Omit<ArenaSessionRow, 'id' | 'created_at'>>): void {
  const d = getDB();
  const sets: string[] = [];
  const values: (string | number | null)[] = [];
  for (const [key, val] of Object.entries(fields)) {
    sets.push(`${key} = ?`);
    values.push(val as string | number | null);
  }
  if (sets.length === 0) return;
  values.push(id);
  d.run(`UPDATE arena_sessions SET ${sets.join(', ')} WHERE id = ?`, values);
  saveDB();
}

// ============================================================
// 百Agent竞技模式 — 创作Agent & 评审Agent 批量持久化
// ============================================================

export function batchInsertArenaWriters(rows: ArenaWriterRow[]): void {
  const d = getDB();
  const stmt = d.prepare(
    `INSERT INTO arena_writers (id, session_id, group_id, name, is_leader, system_agent_id, system_agent_name, base_style_id, style_gene, system_prompt, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const r of rows) {
    stmt.run([r.id, r.session_id, r.group_id, r.name, r.is_leader,
      r.system_agent_id, r.system_agent_name, r.base_style_id,
      r.style_gene, r.system_prompt, r.created_at]);
  }
  stmt.free();
  saveDB();
}

export function listArenaWritersBySession(sessionId: string): ArenaWriterRow[] {
  const d = getDB();
  const results: ArenaWriterRow[] = [];
  const stmt = d.prepare('SELECT * FROM arena_writers WHERE session_id = ? ORDER BY group_id, is_leader DESC');
  stmt.bind([sessionId]);
  while (stmt.step()) {
    results.push(stmt.getAsObject() as unknown as ArenaWriterRow);
  }
  stmt.free();
  return results;
}

export function batchInsertArenaReviewers(rows: ArenaReviewerRow[]): void {
  const d = getDB();
  const stmt = d.prepare(
    `INSERT INTO arena_reviewers (id, session_id, direction_id, direction_name, system_prompt, weight, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const r of rows) {
    stmt.run([r.id, r.session_id, r.direction_id, r.direction_name,
      r.system_prompt, r.weight, r.created_at]);
  }
  stmt.free();
  saveDB();
}

export function listArenaReviewersBySession(sessionId: string): ArenaReviewerRow[] {
  const d = getDB();
  const results: ArenaReviewerRow[] = [];
  const stmt = d.prepare('SELECT * FROM arena_reviewers WHERE session_id = ? ORDER BY direction_id');
  stmt.bind([sessionId]);
  while (stmt.step()) {
    results.push(stmt.getAsObject() as unknown as ArenaReviewerRow);
  }
  stmt.free();
  return results;
}

// ============================================================
// 百Agent竞技模式 — 候选产出 & 评审记录持久化
// ============================================================

export function insertArenaCandidate(row: ArenaCandidateRow): void {
  const d = getDB();
  d.run(
    `INSERT INTO arena_candidates (id, session_id, stage, writer_id, group_id, system_agent_id, system_agent_name, parent_candidate_id, content, character_pool_ids, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [row.id, row.session_id, row.stage, row.writer_id, row.group_id,
     row.system_agent_id, row.system_agent_name, row.parent_candidate_id,
     row.content, row.character_pool_ids, row.created_at],
  );
  saveDB();
}

export function batchInsertArenaCandidates(rows: ArenaCandidateRow[]): void {
  const d = getDB();
  const stmt = d.prepare(
    `INSERT INTO arena_candidates (id, session_id, stage, writer_id, group_id, system_agent_id, system_agent_name, parent_candidate_id, content, character_pool_ids, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const r of rows) {
    stmt.run([r.id, r.session_id, r.stage, r.writer_id, r.group_id,
      r.system_agent_id, r.system_agent_name, r.parent_candidate_id,
      r.content, r.character_pool_ids, r.created_at]);
  }
  stmt.free();
  saveDB();
}

export function listArenaCandidatesByStage(sessionId: string, stage: string): ArenaCandidateRow[] {
  const d = getDB();
  const results: ArenaCandidateRow[] = [];
  const stmt = d.prepare('SELECT * FROM arena_candidates WHERE session_id = ? AND stage = ? ORDER BY created_at');
  stmt.bind([sessionId, stage]);
  while (stmt.step()) {
    results.push(stmt.getAsObject() as unknown as ArenaCandidateRow);
  }
  stmt.free();
  return results;
}

export function insertArenaReview(row: ArenaReviewRow): void {
  const d = getDB();
  d.run(
    `INSERT INTO arena_reviews (id, session_id, candidate_id, reviewer_id, direction_id, stage, score, comments, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [row.id, row.session_id, row.candidate_id, row.reviewer_id,
     row.direction_id, row.stage, row.score, row.comments, row.created_at],
  );
  saveDB();
}

export function batchInsertArenaReviews(rows: ArenaReviewRow[]): void {
  const d = getDB();
  const stmt = d.prepare(
    `INSERT INTO arena_reviews (id, session_id, candidate_id, reviewer_id, direction_id, stage, score, comments, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const r of rows) {
    stmt.run([r.id, r.session_id, r.candidate_id, r.reviewer_id,
      r.direction_id, r.stage, r.score, r.comments, r.created_at]);
  }
  stmt.free();
  saveDB();
}

export function listArenaReviewsByCandidate(candidateId: string): ArenaReviewRow[] {
  const d = getDB();
  const results: ArenaReviewRow[] = [];
  const stmt = d.prepare('SELECT * FROM arena_reviews WHERE candidate_id = ? ORDER BY direction_id');
  stmt.bind([candidateId]);
  while (stmt.step()) {
    results.push(stmt.getAsObject() as unknown as ArenaReviewRow);
  }
  stmt.free();
  return results;
}

// ============================================================
// 百Agent竞技模式 — 综合评分持久化
// ============================================================

export function insertArenaFunnelScore(row: ArenaFunnelScoreRow): void {
  const d = getDB();
  d.run(
    `INSERT INTO arena_funnel_scores (id, session_id, candidate_id, stage, direction_scores, weighted_total, rank, selected, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [row.id, row.session_id, row.candidate_id, row.stage,
     row.direction_scores, row.weighted_total, row.rank, row.selected, row.created_at],
  );
  saveDB();
}

export function batchInsertArenaFunnelScores(rows: ArenaFunnelScoreRow[]): void {
  const d = getDB();
  const stmt = d.prepare(
    `INSERT INTO arena_funnel_scores (id, session_id, candidate_id, stage, direction_scores, weighted_total, rank, selected, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const r of rows) {
    stmt.run([r.id, r.session_id, r.candidate_id, r.stage,
      r.direction_scores, r.weighted_total, r.rank, r.selected, r.created_at]);
  }
  stmt.free();
  saveDB();
}

export function listArenaFunnelScoresByStage(sessionId: string, stage: string): ArenaFunnelScoreRow[] {
  const d = getDB();
  const results: ArenaFunnelScoreRow[] = [];
  const stmt = d.prepare('SELECT * FROM arena_funnel_scores WHERE session_id = ? AND stage = ? ORDER BY rank ASC');
  stmt.bind([sessionId, stage]);
  while (stmt.step()) {
    results.push(stmt.getAsObject() as unknown as ArenaFunnelScoreRow);
  }
  stmt.free();
  return results;
}

export function updateArenaFunnelScoreSelected(candidateId: string, stage: string, selected: boolean): void {
  const d = getDB();
  // 先取消同阶段其他候选的选中状态（幂等）
  const sessionStmt = d.prepare('SELECT session_id FROM arena_funnel_scores WHERE candidate_id = ? AND stage = ? LIMIT 1');
  sessionStmt.bind([candidateId, stage]);
  if (sessionStmt.step()) {
    const { session_id } = sessionStmt.getAsObject() as { session_id: string };
    sessionStmt.free();
    d.run('UPDATE arena_funnel_scores SET selected = 0 WHERE session_id = ? AND stage = ?', [session_id, stage]);
    if (selected) {
      d.run('UPDATE arena_funnel_scores SET selected = 1 WHERE candidate_id = ? AND stage = ?', [candidateId, stage]);
    }
  } else {
    sessionStmt.free();
  }
  saveDB();
}

// ============================================================
// 百Agent竞技模式 — 断点续传状态恢复
// ============================================================

/** 阶段顺序映射，用于断点续传判断 */
const ARENA_STAGE_ORDER: Record<string, number> = {
  'init': 0,
  'stage_plan': 1,
  'stage_char': 2,
  'stage_dir': 3,
  'stage_ep': 4,
  'completed': 5,
  'stopped': -1,
};

/**
 * 断点续传：恢复竞技会话状态
 * 根据 session.status 判断从哪个阶段继续
 * 返回 null 表示会话已完成或不存在
 */
export function getArenaResumeState(sessionId: string): {
  session: ArenaSessionRow;
  resumeStage: string;           // 需要继续执行的阶段
  completedStages: string[];     // 已完成的阶段列表
  writers: ArenaWriterRow[];
  reviewers: ArenaReviewerRow[];
} | null {
  const session = getArenaSession(sessionId);
  if (!session) return null;

  const status = session.status;
  if (status === 'completed') return null;

  // 加载已持久化的Agent数据
  const writers = listArenaWritersBySession(sessionId);
  const reviewers = listArenaReviewersBySession(sessionId);

  // 根据status确定已完成的阶段和需要恢复的阶段
  const stageMap: Record<string, { resumeStage: string; completedStages: string[] }> = {
    'init':       { resumeStage: 'stage_plan', completedStages: [] },
    'stage_plan': { resumeStage: 'stage_plan', completedStages: [] },
    'stage_char': { resumeStage: 'stage_char', completedStages: ['stage_plan'] },
    'stage_dir':  { resumeStage: 'stage_dir',  completedStages: ['stage_plan', 'stage_char'] },
    'stage_ep':   { resumeStage: 'stage_ep',   completedStages: ['stage_plan', 'stage_char', 'stage_dir'] },
    'stopped':    { resumeStage: session.current_stage || 'stage_plan', completedStages: [] },
  };

  // stopped 状态需要根据 current_stage 推算已完成的阶段
  if (status === 'stopped' && session.current_stage) {
    const currentOrder = ARENA_STAGE_ORDER[session.current_stage] ?? 0;
    const allStages = ['stage_plan', 'stage_char', 'stage_dir', 'stage_ep'];
    stageMap['stopped'].completedStages = allStages.filter(
      s => ARENA_STAGE_ORDER[s] < currentOrder,
    );
  }

  const info = stageMap[status];
  if (!info) return null;

  return {
    session,
    resumeStage: info.resumeStage,
    completedStages: info.completedStages,
    writers,
    reviewers,
  };
}

/**
 * 获取某阶段已完成的候选产出（用于断点续传时跳过已完成的阶段）
 */
export function getCompletedStageCandidates(sessionId: string, stage: string): ArenaCandidateRow[] {
  return listArenaCandidatesByStage(sessionId, stage);
}

/**
 * 获取某阶段的评分结果（用于断点续传时恢复排名）
 */
export function getCompletedStageScores(sessionId: string, stage: string): ArenaFunnelScoreRow[] {
  return listArenaFunnelScoresByStage(sessionId, stage);
}