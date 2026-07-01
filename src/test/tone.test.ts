import { describe, it, expect } from 'vitest';
import { BADGE_TONE, SOLID_TONE, badgeTone, solidTone, type Tone } from '@/lib/tone';

const ALL_TONES: Tone[] = [
  'brand',
  'neutral',
  'muted',
  'success',
  'warning',
  'danger',
  'info',
  'ai',
];

describe('tone map (9-A 디자인 토큰)', () => {
  it('모든 tone 이 BADGE_TONE / SOLID_TONE 에 정의돼 있다', () => {
    for (const tone of ALL_TONES) {
      expect(BADGE_TONE[tone]).toBeTruthy();
      expect(SOLID_TONE[tone]).toBeTruthy();
    }
    expect(Object.keys(BADGE_TONE).sort()).toEqual([...ALL_TONES].sort());
    expect(Object.keys(SOLID_TONE).sort()).toEqual([...ALL_TONES].sort());
  });

  it('헬퍼는 맵과 동일한 클래스를 반환한다', () => {
    for (const tone of ALL_TONES) {
      expect(badgeTone(tone)).toBe(BADGE_TONE[tone]);
      expect(solidTone(tone)).toBe(SOLID_TONE[tone]);
    }
  });

  it('BADGE_TONE 은 의미 토큰 클래스만 사용한다(직접 Tailwind 팔레트 색 금지)', () => {
    const palette = /\b(?:bg|text|border)-(?:emerald|blue|violet|amber|orange|sky|indigo|rose|red|green|yellow|gray|neutral-\d)/;
    for (const tone of ALL_TONES) {
      expect(BADGE_TONE[tone]).not.toMatch(palette);
    }
  });

  it('BADGE_TONE 은 각 톤에 부합하는 표면(surface) 배경과 border/text 를 가진다', () => {
    expect(BADGE_TONE.brand).toContain('bg-brand/5');
    expect(BADGE_TONE.neutral).toContain('bg-surface');
    expect(BADGE_TONE.muted).toContain('bg-muted/50');
    expect(BADGE_TONE.success).toContain('bg-success-surface');
    expect(BADGE_TONE.warning).toContain('bg-warning-surface');
    expect(BADGE_TONE.danger).toContain('bg-danger-surface');
    expect(BADGE_TONE.info).toContain('bg-info-surface');
    expect(BADGE_TONE.ai).toContain('bg-ai-surface');

    expect(BADGE_TONE.success).toContain('border-success-border');
    expect(BADGE_TONE.warning).toContain('border-warning-border');
    expect(BADGE_TONE.danger).toContain('border-danger-border');
    expect(BADGE_TONE.info).toContain('border-info-border');
    expect(BADGE_TONE.ai).toContain('border-ai-border');
  });
});
