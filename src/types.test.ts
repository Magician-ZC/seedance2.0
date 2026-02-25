import { describe, it, expect } from 'vitest';
import { RATIO_OPTIONS, DURATION_OPTIONS, MODEL_OPTIONS, DEFAULT_PRESETS, REFERENCE_MODES } from './types';

describe('types constants', () => {
  it('should have 6 ratio options', () => {
    expect(RATIO_OPTIONS).toHaveLength(6);
    expect(RATIO_OPTIONS.map((r) => r.value)).toContain('16:9');
    expect(RATIO_OPTIONS.map((r) => r.value)).toContain('9:16');
  });

  it('should have duration options from 4 to 15', () => {
    expect(DURATION_OPTIONS).toHaveLength(12);
    expect(DURATION_OPTIONS[0]).toBe(4);
    expect(DURATION_OPTIONS[DURATION_OPTIONS.length - 1]).toBe(15);
  });

  it('should have 2 model options', () => {
    expect(MODEL_OPTIONS).toHaveLength(2);
    expect(MODEL_OPTIONS.map((m) => m.value)).toContain('seedance-2.0');
    expect(MODEL_OPTIONS.map((m) => m.value)).toContain('seedance-2.0-fast');
  });

  it('should have preset templates with required fields', () => {
    expect(DEFAULT_PRESETS.length).toBeGreaterThan(0);
    for (const preset of DEFAULT_PRESETS) {
      expect(preset.id).toBeTruthy();
      expect(preset.name).toBeTruthy();
      expect(preset.nameEn).toBeTruthy();
      expect(preset.model).toBeTruthy();
      expect(preset.ratio).toBeTruthy();
      expect(preset.duration).toBeGreaterThanOrEqual(4);
    }
  });

  it('should have 3 reference modes', () => {
    expect(REFERENCE_MODES).toHaveLength(3);
  });
});
