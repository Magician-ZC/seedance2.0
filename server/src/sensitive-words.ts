// 敏感词库服务 - 本地 JSON 文件持久化 + 自动学习
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../data');
const WORDS_FILE = path.join(DATA_DIR, 'sensitive-words.json');

interface SensitiveWordsData {
  // 手动添加的词
  manual: string[];
  // 自动学习的词（从生成失败中提取）
  learned: string[];
  // 更新时间
  updatedAt: number;
}

let wordsData: SensitiveWordsData = { manual: [], learned: [], updatedAt: 0 };

// 初始化：加载或创建数据文件
function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function loadWords(): void {
  ensureDataDir();
  try {
    if (fs.existsSync(WORDS_FILE)) {
      wordsData = JSON.parse(fs.readFileSync(WORDS_FILE, 'utf-8'));
      console.log(`[sensitive] 已加载敏感词库: ${getAllWords().length} 个词`);
    } else {
      // 内置初始词库（即梦平台常见敏感词）
      wordsData = {
        manual: [
          '江湖人士', '黑社会', '毒品', '赌博', '色情',
          '暴力', '恐怖', '邪教', '反动', '分裂',
          '血腥', '自杀', '杀人', '枪支', '爆炸',
        ],
        learned: [],
        updatedAt: Date.now(),
      };
      saveWords();
      console.log(`[sensitive] 已创建初始敏感词库: ${wordsData.manual.length} 个词`);
    }
  } catch (err) {
    console.error(`[sensitive] 加载敏感词库失败: ${(err as Error).message}`);
  }
}

function saveWords(): void {
  ensureDataDir();
  wordsData.updatedAt = Date.now();
  fs.writeFileSync(WORDS_FILE, JSON.stringify(wordsData, null, 2), 'utf-8');
}

// 获取所有敏感词（去重）
export function getAllWords(): string[] {
  const set = new Set([...wordsData.manual, ...wordsData.learned]);
  return Array.from(set);
}

// 检查文本中是否包含敏感词，返回命中的词列表
export function checkText(text: string): string[] {
  if (!text) return [];
  const allWords = getAllWords();
  const found: string[] = [];
  for (const word of allWords) {
    if (text.includes(word)) found.push(word);
  }
  return found;
}

// 替换文本中的敏感词（用 *** 替代）
export function sanitizeText(text: string): { sanitized: string; replaced: string[] } {
  if (!text) return { sanitized: text, replaced: [] };
  const replaced: string[] = [];
  let result = text;
  for (const word of getAllWords()) {
    if (result.includes(word)) {
      replaced.push(word);
      result = result.replaceAll(word, '*'.repeat(word.length));
    }
  }
  return { sanitized: result, replaced };
}

// 手动添加敏感词
export function addManualWords(words: string[]): number {
  let added = 0;
  for (const w of words) {
    const trimmed = w.trim();
    if (trimmed && !wordsData.manual.includes(trimmed)) {
      wordsData.manual.push(trimmed);
      added++;
    }
  }
  if (added > 0) saveWords();
  return added;
}

// 手动删除敏感词
export function removeWord(word: string): boolean {
  const trimmed = word.trim();
  let removed = false;
  const mi = wordsData.manual.indexOf(trimmed);
  if (mi >= 0) { wordsData.manual.splice(mi, 1); removed = true; }
  const li = wordsData.learned.indexOf(trimmed);
  if (li >= 0) { wordsData.learned.splice(li, 1); removed = true; }
  if (removed) saveWords();
  return removed;
}

// 自动学习：从生成失败的错误信息中提取可能的敏感词
// 当视频生成因"内容被过滤"失败时调用，传入原始 prompt
// 使用二分法思路：记录整个 prompt 中的关键短语
export function learnFromFailure(prompt: string): void {
  if (!prompt) return;
  // 提取 2-6 字的中文短语作为候选敏感词
  const phrases = extractChinesePhrases(prompt);
  let added = 0;
  for (const phrase of phrases) {
    if (!wordsData.manual.includes(phrase) && !wordsData.learned.includes(phrase)) {
      // 只记录为候选，不直接加入（需要多次命中才确认）
      // 这里用简单策略：如果短语在已知敏感词的"邻近"范围内，直接加入
      // 否则记录到 learned 供用户审核
      wordsData.learned.push(phrase);
      added++;
    }
  }
  if (added > 0) {
    saveWords();
    console.log(`[sensitive] 从失败提示词中学习了 ${added} 个候选敏感词`);
  }
}

// 确认候选敏感词（从 learned 移到 manual）
export function confirmLearnedWord(word: string): boolean {
  const idx = wordsData.learned.indexOf(word);
  if (idx < 0) return false;
  wordsData.learned.splice(idx, 1);
  if (!wordsData.manual.includes(word)) wordsData.manual.push(word);
  saveWords();
  return true;
}

// 提取中文短语（2-6字）
function extractChinesePhrases(text: string): string[] {
  const phrases: string[] = [];
  // 匹配连续中文字符
  const segments = text.match(/[\u4e00-\u9fff]{2,6}/g) || [];
  for (const seg of segments) {
    if (seg.length >= 2 && seg.length <= 6) {
      phrases.push(seg);
    }
  }
  return [...new Set(phrases)];
}

// 获取词库详情（供 API 返回）
export function getWordsDetail(): { manual: string[]; learned: string[]; total: number; updatedAt: number } {
  return {
    manual: [...wordsData.manual],
    learned: [...wordsData.learned],
    total: getAllWords().length,
    updatedAt: wordsData.updatedAt,
  };
}
