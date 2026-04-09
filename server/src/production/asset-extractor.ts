// 资产提取器：从结构化脚本中自动提取人物/场景/道具，检测跨集变体
import crypto from 'crypto';
const uuid = () => crypto.randomUUID();
import { chatCompletionJSON } from '../llm-service.js';
import type { ParsedScript, ParsedCharacter, ParsedShot } from './script-parser.js';

export interface ExtractedCharacter {
  id: string;
  name: string;
  description: string;
  visualPrompt: string;
  metadata: {
    age: string; gender: string; faceType: string; eyes: string;
    hair: string; skinColor: string; bodyType: string; clothing: string;
    shoes: string; signatureFeatures: string; personality: string;
    background: string; keyExperiences: string;
  };
}

export interface ExtractedLocation {
  id: string;
  name: string;
  description: string;
  visualPrompt: string;
  metadata: {
    interior: boolean; timeOfDay: string; atmosphere: string; keyElements: string[];
  };
}

export interface ExtractedProp {
  id: string;
  name: string;
  description: string;
  visualPrompt: string;
  metadata: {
    category: string; associatedCharacter: string; description: string;
  };
}

export function extractCharactersFromParsed(characters: ParsedCharacter[]): ExtractedCharacter[] {
  return characters.map(c => ({
    id: uuid(),
    name: c.name || c.englishName,
    description: [
      c.gender, c.age ? c.age + '岁' : '',
      c.faceType, c.eyes, c.hair, c.skinColor, c.bodyType, c.personality,
    ].filter(Boolean).join('，'),
    visualPrompt: buildCharacterVisualPrompt(c),
    metadata: {
      age: c.age, gender: c.gender, faceType: c.faceType,
      eyes: c.eyes, hair: c.hair, skinColor: c.skinColor,
      bodyType: c.bodyType, clothing: c.clothing, shoes: c.shoes,
      signatureFeatures: c.signatureFeatures, personality: c.personality,
      background: c.background, keyExperiences: c.keyExperiences,
    },
  }));
}

function buildCharacterVisualPrompt(c: ParsedCharacter): string {
  const parts = [
    `A ${c.gender === '女' ? 'female' : 'male'} character`,
    c.age ? `, age ${c.age}` : '',
    c.faceType ? `, ${c.faceType} face` : '',
    c.eyes ? `, ${c.eyes} eyes` : '',
    c.hair ? `, ${c.hair}` : '',
    c.skinColor ? `, ${c.skinColor} skin` : '',
    c.bodyType ? `, ${c.bodyType}` : '',
    c.clothing ? `. Wearing: ${c.clothing}` : '',
    c.signatureFeatures ? `. Notable features: ${c.signatureFeatures}` : '',
  ];
  return parts.join('');
}

export function extractLocationsFromShots(shots: ParsedShot[]): ExtractedLocation[] {
  const locationMap = new Map<string, { scenes: string[]; shots: ParsedShot[] }>();

  for (const shot of shots) {
    if (!shot.scene) continue;
    const normalized = normalizeLocationName(shot.scene);
    if (!locationMap.has(normalized)) {
      locationMap.set(normalized, { scenes: [], shots: [] });
    }
    const entry = locationMap.get(normalized)!;
    if (!entry.scenes.includes(shot.scene)) entry.scenes.push(shot.scene);
    entry.shots.push(shot);
  }

  return Array.from(locationMap.entries()).map(([name, data]) => {
    const firstScene = data.scenes[0];
    const isInterior = firstScene.includes('内景');
    const timeMatch = firstScene.match(/(白天|黄昏|夜晚|黑夜|清晨|傍晚)/);
    return {
      id: uuid(),
      name,
      description: data.scenes.join(' / '),
      visualPrompt: `${isInterior ? 'Interior' : 'Exterior'} scene: ${name}, ${timeMatch?.[1] || 'daytime'}, photorealistic, cinematic lighting`,
      metadata: {
        interior: isInterior,
        timeOfDay: timeMatch?.[1] || '白天',
        atmosphere: data.shots.map(s => s.visualRequirement).filter(Boolean).join(', ').slice(0, 200),
        keyElements: extractKeyElements(data.shots),
      },
    };
  });
}

function normalizeLocationName(scene: string): string {
  return scene
    .replace(/^(内景|外景)[，,\s]*/g, '')
    .replace(/[，,\s]*(白天|黄昏|夜晚|黑夜|清晨|傍晚)$/g, '')
    .trim();
}

function extractKeyElements(shots: ParsedShot[]): string[] {
  const elements = new Set<string>();
  for (const s of shots) {
    const words = `${s.content} ${s.visualRequirement}`.match(/[\u4e00-\u9fa5a-zA-Z]{2,}/g) || [];
    for (const w of words.slice(0, 5)) elements.add(w);
  }
  return Array.from(elements).slice(0, 10);
}

export async function extractPropsFromScript(parsed: ParsedScript): Promise<ExtractedProp[]> {
  const systemPrompt = `分析分镜脚本，提取重要道具（武器、交通工具、关键物品等）。只提取对剧情有作用或多镜头出现的道具。
返回JSON：
{
  "props": [
    { "name": "道具名称", "category": "武器|交通工具|服饰配件|关键物品|其他", "associatedCharacter": "关联角色名", "description": "描述" }
  ]
}`;

  const userContent = `角色：
${parsed.characters.map(c => `${c.name}: ${c.clothing}, ${c.signatureFeatures}`).join('\n')}

镜头：
${parsed.shots.map(s => `镜头${s.index}: ${s.content}`).join('\n')}`;

  const result = await chatCompletionJSON<{ props: Array<{ name: string; category: string; associatedCharacter: string; description: string }> }>(systemPrompt, userContent);
  const props = result.data?.props || [];
  return props.map(p => ({
    id: uuid(),
    name: p.name,
    description: p.description,
    visualPrompt: `${p.name}, ${p.description}, photorealistic, detailed, studio lighting`,
    metadata: { category: p.category, associatedCharacter: p.associatedCharacter, description: p.description },
  }));
}

export async function detectVariants(
  characters: ExtractedCharacter[],
  episodeScripts: Array<{ episodeNumber: number; shots: ParsedShot[] }>
): Promise<Array<{ characterName: string; episodeNumber: number; variantLabel: string; description: string }>> {
  if (episodeScripts.length <= 1) return [];

  const systemPrompt = `分析多集分镜脚本中角色的外观变化（换装、受伤、状态变化等）。
返回JSON：
{ "variants": [{ "characterName": "角色名", "episodeNumber": 2, "variantLabel": "换装-战斗装", "description": "描述" }] }
只返回确实发生了外观变化的情况。`;

  const userContent = `角色列表：
${characters.map(c => `${c.name}: 初始服装 - ${c.metadata.clothing}`).join('\n')}

各集摘要：
${episodeScripts.map(ep => `第${ep.episodeNumber}集: ${ep.shots.map(s => s.content).join(' | ').slice(0, 500)}`).join('\n\n')}`;

  const result = await chatCompletionJSON<{ variants: Array<{ characterName: string; episodeNumber: number; variantLabel: string; description: string }> }>(systemPrompt, userContent);
  return result.data?.variants || [];
}

export function linkShotsToAssets(
  shots: ParsedShot[],
  characters: ExtractedCharacter[],
  locations: ExtractedLocation[],
  props: ExtractedProp[]
): ParsedShot[] {
  return shots.map(shot => {
    const charRefs: string[] = [];
    const locRefs: string[] = [];
    const propRefs: string[] = [];

    const shotText = `${shot.content} ${shot.dialogue || ''}`.toUpperCase();

    for (const c of characters) {
      if (shotText.includes(c.name.toUpperCase())) charRefs.push(c.id);
    }

    for (const l of locations) {
      if (shot.scene && normalizeLocationName(shot.scene) === l.name) locRefs.push(l.id);
    }

    for (const p of props) {
      if (shotText.includes(p.name.toUpperCase())) propRefs.push(p.id);
    }

    return { ...shot, characterRefs: charRefs, locationRefs: locRefs, propRefs: propRefs };
  });
}
