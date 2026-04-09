// 智能分段算法：将一集的镜头序列按场景感知 + 时长上限进行分段
// 每个段落不超过 maxDuration（默认15s），同一场景尽量合并

import crypto from 'crypto';

export interface ShotInput {
  index: number;
  scene: string;
  content: string;
  cameraWork: string;
  visualRequirement: string;
  soundDesign: string;
  duration: number;
  dialogue?: string;
  characterRefs?: string[];
}

export interface Segment {
  id: string;
  segmentIndex: number;
  shots: ShotInput[];
  totalDuration: number;
  mergedPrompt: string;
  transitionHint: string;
}

export function buildSegments(shots: ShotInput[], maxDuration = 15): Segment[] {
  if (!shots.length) return [];

  const segments: Segment[] = [];
  let current: ShotInput[] = [];
  let currentDuration = 0;
  let segmentIndex = 0;

  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i];
    const shotDur = shot.duration || 2;
    const prevScene = current.length > 0 ? current[current.length - 1].scene : null;
    const sceneChanged = prevScene !== null && shot.scene !== prevScene;

    // 场景变化且当前段已有内容 → 优先在此切段
    if (sceneChanged && current.length > 0) {
      segments.push(createSegment(segmentIndex++, current, currentDuration, shots, i));
      current = [];
      currentDuration = 0;
    }

    // 当前段加入此镜头后会超限 → 先切段
    if (currentDuration + shotDur > maxDuration && current.length > 0) {
      segments.push(createSegment(segmentIndex++, current, currentDuration, shots, i));
      current = [];
      currentDuration = 0;
    }

    current.push(shot);
    currentDuration += shotDur;

    // 单镜头超长（>= maxDuration）时独立成段
    if (currentDuration >= maxDuration) {
      segments.push(createSegment(segmentIndex++, current, currentDuration, shots, i + 1));
      current = [];
      currentDuration = 0;
    }
  }

  if (current.length > 0) {
    segments.push(createSegment(segmentIndex, current, currentDuration, shots, shots.length));
  }

  return segments;
}

function createSegment(
  segmentIndex: number,
  shots: ShotInput[],
  totalDuration: number,
  allShots: ShotInput[],
  nextIndex: number,
): Segment {
  const mergedPrompt = buildMergedPrompt(shots);
  const transitionHint = buildTransitionHint(shots, allShots, nextIndex);

  return {
    id: crypto.randomUUID(),
    segmentIndex,
    shots: [...shots],
    totalDuration,
    mergedPrompt,
    transitionHint,
  };
}

function buildMergedPrompt(shots: ShotInput[]): string {
  const parts: string[] = [];
  for (let i = 0; i < shots.length; i++) {
    const s = shots[i];
    let part = s.content;
    if (s.cameraWork) part += `, ${s.cameraWork}`;
    if (s.visualRequirement) part += `, ${s.visualRequirement}`;

    if (i > 0 && shots[i].scene !== shots[i - 1].scene) {
      part = `镜头切换到${s.scene}: ${part}`;
    }
    parts.push(part);
  }
  return parts.join('. ');
}

function buildTransitionHint(
  currentShots: ShotInput[],
  allShots: ShotInput[],
  nextIndex: number,
): string {
  if (nextIndex >= allShots.length) return '本集最后一段';
  const lastShot = currentShots[currentShots.length - 1];
  const nextShot = allShots[nextIndex];
  if (lastShot.scene === nextShot.scene) {
    return `延续场景「${lastShot.scene}」`;
  }
  return `从「${lastShot.scene}」过渡到「${nextShot.scene}」`;
}
