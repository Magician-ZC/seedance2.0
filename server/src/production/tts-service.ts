// TTS配音服务：Provider抽象 + 豆包(火山引擎)TTS实现 + 角色-音色绑定
import { fetch as undiciFetch } from 'undici';
import crypto from 'crypto';

// ==================== Provider 接口 ====================

export interface VoiceOption {
  voiceId: string;
  name: string;
  gender: string;
  language: string;
  tags: string[];
  sampleUrl?: string;
}

export interface TTSSynthesizeParams {
  text: string;
  voiceId: string;
  speed?: number;
  pitch?: number;
  emotion?: string;
  format?: 'mp3' | 'wav';
}

export interface TTSProvider {
  name: string;
  listVoices(language: string): Promise<VoiceOption[]>;
  synthesize(params: TTSSynthesizeParams): Promise<Buffer>;
}

// ==================== 豆包 TTS Provider ====================

interface DoubaoConfig {
  appId: string;
  accessToken: string;
  clusterId?: string;
}

let doubaoConfig: DoubaoConfig | null = null;

export function setDoubaoConfig(config: DoubaoConfig): void {
  doubaoConfig = config;
}

export function getDoubaoConfig(): DoubaoConfig | null {
  return doubaoConfig;
}

const DOUBAO_VOICES: VoiceOption[] = [
  { voiceId: 'en_us_male_adam', name: 'Adam', gender: 'male', language: 'en', tags: ['deep', 'mature'] },
  { voiceId: 'en_us_female_sarah', name: 'Sarah', gender: 'female', language: 'en', tags: ['warm', 'natural'] },
  { voiceId: 'en_us_male_ryan', name: 'Ryan', gender: 'male', language: 'en', tags: ['energetic', 'young'] },
  { voiceId: 'en_us_female_emma', name: 'Emma', gender: 'female', language: 'en', tags: ['gentle', 'soft'] },
  { voiceId: 'en_us_male_david', name: 'David', gender: 'male', language: 'en', tags: ['authoritative', 'news'] },
  { voiceId: 'en_us_female_lily', name: 'Lily', gender: 'female', language: 'en', tags: ['cheerful', 'bright'] },
  { voiceId: 'en_gb_male_james', name: 'James', gender: 'male', language: 'en', tags: ['british', 'elegant'] },
  { voiceId: 'en_gb_female_olivia', name: 'Olivia', gender: 'female', language: 'en', tags: ['british', 'refined'] },
  { voiceId: 'zh_cn_male_narrator', name: '旁白男', gender: 'male', language: 'zh', tags: ['narrator', 'standard'] },
  { voiceId: 'zh_cn_female_narrator', name: '旁白女', gender: 'female', language: 'zh', tags: ['narrator', 'standard'] },
];

class DoubaoTTSProvider implements TTSProvider {
  name = 'doubao';

  async listVoices(language: string): Promise<VoiceOption[]> {
    return DOUBAO_VOICES.filter(v => v.language === language || language === 'all');
  }

  async synthesize(params: TTSSynthesizeParams): Promise<Buffer> {
    if (!doubaoConfig) throw new Error('豆包TTS未配置，请先设置 appId 和 accessToken');

    const { text, voiceId, speed = 1.0, format = 'mp3' } = params;

    const payload = {
      app: { appid: doubaoConfig.appId, cluster: doubaoConfig.clusterId || 'volcano_tts' },
      user: { uid: 'production-tts' },
      audio: {
        voice_type: voiceId,
        encoding: format === 'wav' ? 'wav' : 'mp3',
        speed_ratio: speed,
      },
      request: {
        reqid: crypto.randomUUID(),
        text,
        operation: 'query',
      },
    };

    const resp = await undiciFetch('https://openspeech.bytedance.com/api/v1/tts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer; ${doubaoConfig.accessToken}`,
      },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`豆包TTS请求失败: ${resp.status} ${errText}`);
    }

    const result = await resp.json() as { code: number; message: string; data?: string };

    if (result.code !== 3000 || !result.data) {
      throw new Error(`豆包TTS生成失败: ${result.message}`);
    }

    return Buffer.from(result.data, 'base64');
  }
}

// ==================== Provider 注册表 ====================

const providers = new Map<string, TTSProvider>();
providers.set('doubao', new DoubaoTTSProvider());

export function getTTSProvider(name: string): TTSProvider {
  const provider = providers.get(name);
  if (!provider) throw new Error(`未知的TTS provider: ${name}`);
  return provider;
}

export function listTTSProviders(): string[] {
  return Array.from(providers.keys());
}

// ==================== 台词解析 ====================

export interface DialogueLine {
  characterName: string;
  text: string;
  emotion?: string;
}

export function parseDialogue(dialogue: string): DialogueLine[] {
  if (!dialogue || !dialogue.trim()) return [];

  const lines: DialogueLine[] = [];
  // 匹配 "角色名(情感): "文本"" 或 "角色名: "文本""
  const regex = /([A-Z\u4e00-\u9fa5]+)\s*(?:\(([^)]+)\))?\s*[:：]\s*["""]?([^"""\n]+)["""]?/g;
  let match;

  while ((match = regex.exec(dialogue)) !== null) {
    lines.push({
      characterName: match[1].trim(),
      emotion: match[2]?.trim(),
      text: match[3].trim().replace(/^["'"']|["'"']$/g, ''),
    });
  }

  if (lines.length === 0 && dialogue.trim()) {
    lines.push({ characterName: 'NARRATOR', text: dialogue.trim() });
  }

  return lines;
}

// ==================== 批量生成 ====================

export interface BatchTTSTask {
  shotIndex: number;
  dialogueLines: DialogueLine[];
  voiceBindings: Map<string, string>;
}

export async function synthesizeDialogue(
  providerName: string,
  line: DialogueLine,
  voiceId: string,
  speed: number = 1.0
): Promise<Buffer> {
  const provider = getTTSProvider(providerName);
  return provider.synthesize({
    text: line.text,
    voiceId,
    speed,
    emotion: line.emotion,
  });
}
