// 脚本解析引擎：docx/txt 上传 → AI结构化提取 → 合规清洗
import mammoth from 'mammoth';
import { chatCompletionJSON } from '../llm-service.js';

export interface ParsedCharacter {
  name: string;
  englishName: string;
  age: string;
  gender: string;
  faceType: string;
  eyes: string;
  hair: string;
  skinColor: string;
  bodyType: string;
  clothing: string;
  shoes: string;
  signatureFeatures: string;
  personality: string;
  background: string;
  keyExperiences: string;
}

export interface ParsedShot {
  index: number;
  scene: string;
  content: string;
  cameraWork: string;
  visualRequirement: string;
  soundDesign: string;
  duration: number;
  dialogue: string;
  note: string;
  characterRefs?: string[];
  locationRefs?: string[];
  propRefs?: string[];
}

export interface ParsedScript {
  characters: ParsedCharacter[];
  shots: ParsedShot[];
  warnings: string[];
}

export interface EpisodeSummary {
  episodeNumber: number;
  plotSummary: string;
  characterStates: string;
  lastScene: string;
  emotionalTone: string;
}

export async function parseDocxBuffer(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

/**
 * 为已解析的剧集生成叙事摘要，供下一集参照
 */
export async function generateEpisodeSummary(parsed: ParsedScript, episodeNumber: number): Promise<EpisodeSummary> {
  const systemPrompt = `你是专业的短剧剧情分析师。请为以下分镜脚本生成一份精炼摘要，供下一集编剧参照以保持叙事连贯。
输出JSON格式：
{
  "episodeNumber": ${episodeNumber},
  "plotSummary": "本集核心剧情发展（2-3句话）",
  "characterStates": "各主要角色在本集结尾时的状态/情绪/穿着变化",
  "lastScene": "本集最后一个镜头的场景和内容描述",
  "emotionalTone": "本集整体情绪基调和结尾氛围"
}`;

  const userContent = JSON.stringify({
    characters: parsed.characters.map(c => ({ name: c.name, englishName: c.englishName })),
    shots: parsed.shots.map(s => ({ index: s.index, scene: s.scene, content: s.content, dialogue: s.dialogue })),
  }, null, 2).slice(0, 15000);

  const result = await chatCompletionJSON<EpisodeSummary>(systemPrompt, userContent);
  if (result.success && result.data) return result.data;

  return {
    episodeNumber,
    plotSummary: parsed.shots.slice(-3).map(s => s.content).join('；'),
    characterStates: parsed.characters.map(c => c.name).join(', '),
    lastScene: parsed.shots[parsed.shots.length - 1]?.scene || '',
    emotionalTone: '',
  };
}

/**
 * 解析脚本文本，可选注入前集摘要保持连贯性
 */
export async function parseScriptText(rawText: string, prevSummary?: EpisodeSummary): Promise<ParsedScript> {
  const continuityBlock = prevSummary ? `

【重要 - 前集衔接信息】
本集是第${prevSummary.episodeNumber + 1}集，需要与上一集内容衔接。
上集剧情：${prevSummary.plotSummary}
角色状态：${prevSummary.characterStates}
上集末尾场景：${prevSummary.lastScene}
上集情绪基调：${prevSummary.emotionalTone}

解析时请注意：
- 角色的服装/造型如果与上集不同，在 clothing 字段中明确标注变化
- 第一个镜头的场景应能从上集末尾场景自然衔接
- 关注角色状态的延续性` : '';

  const systemPrompt = `你是一个专业的分镜脚本解析器。将输入的分镜脚本文本解析为结构化JSON。

脚本中通常包含两部分：
1. 人物设定表：角色名、年龄、性别、脸型、眼睛、头发、肤色、身材、服饰、鞋子、标志特征、性格、背景、关键经历
2. 分镜表：镜头序号、场景描述、镜头内容、拍摄方法、画面要求、声音效果、时间、台词、备注

由于原始文本是从表格转为纯文本，可能存在列分隔不清、断字等问题，请根据上下文智能识别字段边界。${continuityBlock}

输出JSON格式：
{
  "characters": [
    { "name": "中文名", "englishName": "English", "age": "", "gender": "", "faceType": "", "eyes": "", "hair": "", "skinColor": "", "bodyType": "", "clothing": "", "shoes": "", "signatureFeatures": "", "personality": "", "background": "", "keyExperiences": "" }
  ],
  "shots": [
    { "index": 1, "scene": "", "content": "", "cameraWork": "", "visualRequirement": "", "soundDesign": "", "duration": 3, "dialogue": "", "note": "" }
  ],
  "warnings": []
}`;

  const userContent = rawText.slice(0, 30000);
  const result = await chatCompletionJSON<ParsedScript>(systemPrompt, userContent);
  if (!result.success || !result.data) {
    throw new Error(`脚本解析失败: ${result.error || '未知错误'}`);
  }
  return result.data;
}

export interface CleaningRule {
  name: string;
  check: (shots: ParsedShot[], characters: ParsedCharacter[]) => string[];
}

const CLEANING_RULES: CleaningRule[] = [
  {
    name: '镜头时长检查',
    check: (shots) => {
      const warnings: string[] = [];
      for (const s of shots) {
        if (s.duration < 1) warnings.push(`镜头${s.index}: 时长${s.duration}s < 1s`);
        if (s.duration > 3) warnings.push(`镜头${s.index}: 时长${s.duration}s > 3s`);
      }
      return warnings;
    }
  },
  {
    name: '总时长检查',
    check: (shots) => {
      const total = shots.reduce((sum, s) => sum + s.duration, 0);
      if (total < 50) return [`总时长${total}s < 50s`];
      if (total > 60) return [`总时长${total}s > 60s`];
      return [];
    }
  },
  {
    name: '禁用镜头类型检查',
    check: (shots) => {
      const forbidden = ['慢镜头', '发呆', '思考镜头', '人物背面'];
      const warnings: string[] = [];
      for (const s of shots) {
        const combined = `${s.content} ${s.cameraWork} ${s.note}`;
        for (const kw of forbidden) {
          if (combined.includes(kw)) warnings.push(`镜头${s.index}: 包含禁用类型「${kw}」`);
        }
      }
      return warnings;
    }
  },
  {
    name: '暴力内容检查',
    check: (shots) => {
      const violenceKw = ['血腥', '暴力', '血液', '鲜血'];
      const warnings: string[] = [];
      for (const s of shots) {
        const combined = `${s.content} ${s.visualRequirement}`;
        for (const kw of violenceKw) {
          if (combined.includes(kw) && !(s.cameraWork || '').includes('远景')) {
            warnings.push(`镜头${s.index}: 暴力内容「${kw}」建议远景处理`);
          }
        }
      }
      return warnings;
    }
  },
];

export function cleanScript(parsed: ParsedScript): { cleaned: ParsedScript; issues: string[] } {
  const allIssues: string[] = [];
  for (const rule of CLEANING_RULES) {
    allIssues.push(...rule.check(parsed.shots, parsed.characters));
  }
  return { cleaned: parsed, issues: allIssues };
}

export async function aiCleanScript(
  parsed: ParsedScript,
  requirementsText: string,
  prevSummary?: EpisodeSummary,
): Promise<ParsedScript> {
  const continuityRule = prevSummary ? `
6. 【跨集连贯性】本集紧接第${prevSummary.episodeNumber}集：
   - 上集剧情：${prevSummary.plotSummary}
   - 角色结尾状态：${prevSummary.characterStates}
   - 上集末尾场景：${prevSummary.lastScene}
   - 确保本集开头与上集结尾自然衔接，不要出现割裂感
   - 角色情绪和穿着需延续上集状态（除非脚本明确标注变化）` : '';

  const systemPrompt = `你是专业的短剧分镜脚本审核编辑。根据制作要求对脚本进行清洗和优化。
处理规则：
1. 调整不符合时长要求的镜头（每镜头1-3秒，总时长50-60秒）
2. 替换禁用镜头类型（慢镜头/发呆/思考/背面）
3. 确保角色描述适合AI视频生成
4. 暴力镜头改为远景处理
5. 确保台词是英文${continuityRule}
返回优化后的完整脚本JSON（格式同输入）。`;

  const userContent = `制作要求：
${requirementsText || '标准制作要求：9:16竖屏，禁止CG风，每镜头1-3秒'}

脚本数据：
${JSON.stringify(parsed, null, 2).slice(0, 25000)}`;

  const result = await chatCompletionJSON<ParsedScript>(systemPrompt, userContent);
  if (!result.success || !result.data) {
    throw new Error(`AI清洗失败: ${result.error || '未知错误'}`);
  }
  return result.data;
}
