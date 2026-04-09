// 质检模块：基于制作规范的自动规则校验

export type QualityLevel = 'pass' | 'warning' | 'fail';

export interface QualityCheckItem {
  rule: string;
  level: QualityLevel;
  message: string;
  episodeNumber?: number;
  shotIndex?: number;
}

export interface QualityReport {
  projectId: string;
  totalChecks: number;
  passed: number;
  warnings: number;
  failures: number;
  items: QualityCheckItem[];
  checkedAt: number;
}

interface EpisodeData {
  episodeNumber: number;
  shots: Array<{
    index: number;
    duration: number;
    dialogue?: string;
    content: string;
    cameraWork?: string;
    visualRequirement?: string;
    videoStatus?: string;
    videoUrl?: string;
    audioStatus?: string;
    characterRefs?: string[];
    note?: string;
  }>;
}

export function runQualityCheck(
  projectId: string,
  episodes: EpisodeData[],
  config?: { shotDurationMin?: number; shotDurationMax?: number; episodeDurationMin?: number; episodeDurationMax?: number }
): QualityReport {
  const items: QualityCheckItem[] = [];
  const shotMin = config?.shotDurationMin ?? 1;
  const shotMax = config?.shotDurationMax ?? 3;
  const epMin = config?.episodeDurationMin ?? 50;
  const epMax = config?.episodeDurationMax ?? 60;

  for (const ep of episodes) {
    const epNum = ep.episodeNumber;

    // 总时长
    const totalDuration = ep.shots.reduce((sum, s) => sum + (s.duration || 0), 0);
    if (totalDuration < epMin) {
      items.push({ rule: '集时长下限', level: 'fail', message: `第${epNum}集总时长${totalDuration}s < ${epMin}s`, episodeNumber: epNum });
    } else if (totalDuration > epMax) {
      items.push({ rule: '集时长上限', level: 'warning', message: `第${epNum}集总时长${totalDuration}s > ${epMax}s`, episodeNumber: epNum });
    } else {
      items.push({ rule: '集时长', level: 'pass', message: `第${epNum}集时长${totalDuration}s 合格`, episodeNumber: epNum });
    }

    for (const shot of ep.shots) {
      // 单镜头时长
      if (shot.duration < shotMin) {
        items.push({ rule: '镜头时长下限', level: 'warning', message: `第${epNum}集镜头${shot.index}: ${shot.duration}s < ${shotMin}s`, episodeNumber: epNum, shotIndex: shot.index });
      }
      if (shot.duration > shotMax) {
        items.push({ rule: '镜头时长上限', level: 'warning', message: `第${epNum}集镜头${shot.index}: ${shot.duration}s > ${shotMax}s`, episodeNumber: epNum, shotIndex: shot.index });
      }

      // 禁用镜头类型
      const combined = `${shot.content || ''} ${shot.cameraWork || ''} ${shot.note || ''}`;
      const forbidden = ['慢镜头', '发呆', '思考镜头', '背面镜头'];
      for (const kw of forbidden) {
        if (combined.includes(kw)) {
          items.push({ rule: '禁用镜头', level: 'fail', message: `第${epNum}集镜头${shot.index}: 包含禁用类型「${kw}」`, episodeNumber: epNum, shotIndex: shot.index });
        }
      }

      // 视频生成状态
      if (shot.videoStatus === 'error') {
        items.push({ rule: '视频生成', level: 'fail', message: `第${epNum}集镜头${shot.index}: 视频生成失败`, episodeNumber: epNum, shotIndex: shot.index });
      }

      // 台词存在但无配音
      if (shot.dialogue && shot.audioStatus !== 'done') {
        items.push({ rule: '配音完成', level: 'warning', message: `第${epNum}集镜头${shot.index}: 有台词但未完成配音`, episodeNumber: epNum, shotIndex: shot.index });
      }

      // 角色引用检查
      if (!shot.characterRefs || shot.characterRefs.length === 0) {
        if (shot.dialogue) {
          items.push({ rule: '角色引用', level: 'warning', message: `第${epNum}集镜头${shot.index}: 有台词但未关联角色`, episodeNumber: epNum, shotIndex: shot.index });
        }
      }
    }
  }

  const passed = items.filter(i => i.level === 'pass').length;
  const warnings = items.filter(i => i.level === 'warning').length;
  const failures = items.filter(i => i.level === 'fail').length;

  return {
    projectId,
    totalChecks: items.length,
    passed,
    warnings,
    failures,
    items,
    checkedAt: Date.now(),
  };
}
