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

  saveDB();
}

// 保存数据库到文件
function saveDB(): void {
  if (!db) return;
  const data = db.export();
  fs.writeFileSync(DB_FILE, Buffer.from(data));
}

// 获取数据库实例
function getDB(): Database {
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
    const stmt = d.prepare('SELECT key, value FROM llm_config');
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
    return null; // 表不存在
  }
}
