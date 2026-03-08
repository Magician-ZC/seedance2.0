// 经验存储层 - 经验的类型定义与数据库初始化
// 复用 db-service.ts 的 getDB/saveDB 模式

import { getDB, saveDB } from './db-service.js';

// ============================================================
// 类型定义
// ============================================================

/** 经验类型枚举 */
export type ExperienceType = 'error_pattern' | 'success_pattern' | 'genre_rule' | 'audience_rule';

/** 经验数据行 - 对应 experiences 表的完整字段 */
export interface ExperienceRow {
  id: string;                    // UUID
  type: ExperienceType;          // 经验类型
  genres: string;                // JSON数组字符串，适用题材列表 如 '["都市","悬疑"]'
  audience: string;              // 适用受众：'男频' | '女频' | '全年龄' | ''（空=通用）
  summary: string;               // 经验内容摘要
  source_project_id: string;     // 来源项目ID
  source_mode: 'loop' | 'arena'; // 来源模式
  quality_score: number;         // 质量分数 0-100
  reference_count: number;       // 引用次数
  created_at: number;            // 创建时间戳
  updated_at: number;            // 更新时间戳
}

/** 经验筛选条件 */
export interface ExperienceFilter {
  type?: ExperienceType;
  genre?: string;
  audience?: string;
  minScore?: number;
}

/** 经验库统计信息 */
export interface ExperienceStats {
  total: number;
  byType: Record<ExperienceType, number>;
  byGenre: Record<string, number>;
  avgQualityScore: number;
}

/** 经验匹配选项 */
export interface MatchOptions {
  minScore?: number;          // 最低质量分数，默认40
  maxReferenceCount?: number; // 引用次数上限，默认50
  limit?: number;             // 最大返回条数，默认20
}

// ============================================================
// 数据库初始化
// ============================================================

/** 初始化 experiences 表（在 initDB 中调用） */
export function initExperienceTable(): void {
  const d = getDB();
  d.run(`CREATE TABLE IF NOT EXISTS experiences (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    genres TEXT DEFAULT '[]',
    audience TEXT DEFAULT '',
    summary TEXT NOT NULL,
    source_project_id TEXT NOT NULL,
    source_mode TEXT NOT NULL,
    quality_score REAL DEFAULT 0,
    reference_count INTEGER DEFAULT 0,
    created_at INTEGER,
    updated_at INTEGER
  )`);
  saveDB();
}

// ============================================================
// CRUD 操作
// ============================================================

/** 插入一条经验 */
export function insertExperience(exp: ExperienceRow): void {
  const d = getDB();
  d.run(
    `INSERT INTO experiences (id, type, genres, audience, summary, source_project_id, source_mode, quality_score, reference_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [exp.id, exp.type, exp.genres, exp.audience, exp.summary,
     exp.source_project_id, exp.source_mode, exp.quality_score,
     exp.reference_count, exp.created_at, exp.updated_at],
  );
  saveDB();
}

/** 按ID查询单条经验 */
export function getExperienceById(id: string): ExperienceRow | null {
  const d = getDB();
  const stmt = d.prepare('SELECT * FROM experiences WHERE id = ?');
  stmt.bind([id]);
  if (stmt.step()) {
    const row = stmt.getAsObject() as unknown as ExperienceRow;
    stmt.free();
    return row;
  }
  stmt.free();
  return null;
}

/** 查询经验列表，支持按 type、genre、audience、minScore 筛选 */
export function listExperiences(filter?: ExperienceFilter): ExperienceRow[] {
  const d = getDB();
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (filter?.type) {
    conditions.push('type = ?');
    params.push(filter.type);
  }
  if (filter?.genre) {
    // genres 字段为 JSON 数组字符串，使用 LIKE 进行模糊匹配
    conditions.push('genres LIKE ?');
    params.push(`%"${filter.genre}"%`);
  }
  if (filter?.audience) {
    conditions.push('audience = ?');
    params.push(filter.audience);
  }
  if (filter?.minScore !== undefined) {
    conditions.push('quality_score >= ?');
    params.push(filter.minScore);
  }

  const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
  const sql = `SELECT * FROM experiences${where} ORDER BY created_at DESC`;

  const stmt = d.prepare(sql);
  if (params.length > 0) {
    stmt.bind(params);
  }

  const results: ExperienceRow[] = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject() as unknown as ExperienceRow);
  }
  stmt.free();
  return results;
}

/** 更新经验的可编辑字段 */
export function updateExperience(id: string, fields: Partial<ExperienceRow>): void {
  const d = getDB();
  const sets: string[] = [];
  const values: (string | number | null)[] = [];

  for (const [key, val] of Object.entries(fields)) {
    if (key === 'id' || key === 'created_at') continue; // 不允许修改 id 和创建时间
    sets.push(`${key} = ?`);
    values.push(val as string | number | null);
  }
  if (sets.length === 0) return;

  // 自动更新 updated_at
  sets.push('updated_at = ?');
  values.push(Date.now());
  values.push(id);

  d.run(`UPDATE experiences SET ${sets.join(', ')} WHERE id = ?`, values);
  saveDB();
}

/** 删除一条经验 */
export function deleteExperience(id: string): void {
  const d = getDB();
  d.run('DELETE FROM experiences WHERE id = ?', [id]);
  saveDB();
}

/** 递增经验的引用次数 */
export function incrementReferenceCount(id: string): void {
  const d = getDB();
  d.run(
    'UPDATE experiences SET reference_count = reference_count + 1, updated_at = ? WHERE id = ?',
    [Date.now(), id],
  );
  saveDB();
}

// ============================================================
// 辅助查询
// ============================================================

/** 按来源项目ID查询经验列表（用于去重） */
export function listExperiencesBySourceProject(projectId: string): ExperienceRow[] {
  const d = getDB();
  const stmt = d.prepare('SELECT * FROM experiences WHERE source_project_id = ? ORDER BY created_at DESC');
  stmt.bind([projectId]);

  const results: ExperienceRow[] = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject() as unknown as ExperienceRow);
  }
  stmt.free();
  return results;
}

/** 获取经验库统计信息 */
export function getExperienceStats(): ExperienceStats {
  const d = getDB();

  // 总数
  const totalStmt = d.prepare('SELECT COUNT(*) as cnt FROM experiences');
  totalStmt.step();
  const total = (totalStmt.getAsObject() as { cnt: number }).cnt;
  totalStmt.free();

  // 按类型分布
  const typeStmt = d.prepare('SELECT type, COUNT(*) as cnt FROM experiences GROUP BY type');
  const byType: Record<string, number> = {};
  while (typeStmt.step()) {
    const row = typeStmt.getAsObject() as { type: string; cnt: number };
    byType[row.type] = row.cnt;
  }
  typeStmt.free();

  // 确保四种类型都有值
  const allTypes: ExperienceType[] = ['error_pattern', 'success_pattern', 'genre_rule', 'audience_rule'];
  for (const t of allTypes) {
    if (!(t in byType)) byType[t] = 0;
  }

  // 按题材分布（需要解析 JSON 数组）
  const genreStmt = d.prepare('SELECT genres FROM experiences');
  const genreCount: Record<string, number> = {};
  while (genreStmt.step()) {
    const row = genreStmt.getAsObject() as { genres: string };
    try {
      const genres: string[] = JSON.parse(row.genres);
      for (const g of genres) {
        genreCount[g] = (genreCount[g] || 0) + 1;
      }
    } catch {
      // 解析失败则跳过
    }
  }
  genreStmt.free();

  // 平均质量分数
  const avgStmt = d.prepare('SELECT AVG(quality_score) as avg_score FROM experiences');
  avgStmt.step();
  const avgRow = avgStmt.getAsObject() as { avg_score: number | null };
  const avgQualityScore = avgRow.avg_score ?? 0;
  avgStmt.free();

  return {
    total,
    byType: byType as Record<ExperienceType, number>,
    byGenre: genreCount,
    avgQualityScore: Math.round(avgQualityScore * 100) / 100,
  };
}
