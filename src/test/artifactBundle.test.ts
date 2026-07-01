import { describe, it, expect } from 'vitest';
import {
  filterCounselingLogs,
  filterEventResponses,
  filterExpertResponses,
  buildArtifactSummarySheet,
  buildExpertSurveySheet,
  sanitizeSegment,
  companyFolderName,
  extFromPath,
  bundlePhotoName,
  bundleFilename,
} from '@/lib/artifactBundle';
import type { ReportCounselingLog } from '@/hooks/useCounselingReport';
import type { ReportResponse } from '@/hooks/useSurveyReport';
import type { ExpertResponse } from '@/lib/expertSurveyReport';
import type { SurveyQuestion } from '@/types/satisfaction';
import type { AssignableUser } from '@/types/eventDetail';

const ids = new Set(['A', 'B']);

describe('필터 — 선택 기업 한정', () => {
  it('상담일지는 startup_id 가 선택집합에 든 것만', () => {
    const logs = [
      { startup_id: 'A', session_status: 'COMPLETED' },
      { startup_id: 'C', session_status: 'COMPLETED' },
      { startup_id: null, session_status: 'WAITING' },
    ] as ReportCounselingLog[];
    expect(filterCounselingLogs(logs, ids).map((l) => l.startup_id)).toEqual(['A']);
  });

  it('행사 만족도는 STARTUP 응답 + user_id 선택집합', () => {
    const resp = [
      { id: '1', user_id: 'A', user_role: 'STARTUP', submitted_at: '', answers: [] },
      { id: '2', user_id: 'A', user_role: 'EXPERT', submitted_at: '', answers: [] },
      { id: '3', user_id: 'C', user_role: 'STARTUP', submitted_at: '', answers: [] },
    ] as ReportResponse[];
    expect(filterEventResponses(resp, ids).map((r) => r.id)).toEqual(['1']);
  });

  it('전문가 만족도는 응답자(user_id) 선택집합', () => {
    const resp = [
      { id: '1', user_id: 'A', target_expert_id: 'X', slot_id: 's', submitted_at: '', answers: [] },
      { id: '2', user_id: 'C', target_expert_id: 'X', slot_id: 's', submitted_at: '', answers: [] },
    ] as ExpertResponse[];
    expect(filterExpertResponses(resp, ids).map((r) => r.id)).toEqual(['1']);
  });
});

describe('buildArtifactSummarySheet', () => {
  it('사진 기업 수·전체 사진 수를 집계한다', () => {
    const sheet = buildArtifactSummarySheet({
      eventTitle: '청년 페어',
      companies: [
        { userId: 'A', companyName: '가', contactName: '' },
        { userId: 'B', companyName: '나', contactName: '' },
      ],
      photoCountByCompany: new Map([['A', 3]]),
      counselingCount: 5,
      eventSurveyCount: 2,
      expertSurveyCount: 4,
    });
    const map = new Map(sheet.rows.map((r) => [r[0], r[1]]));
    expect(map.get('선택 기업 수')).toBe(2);
    expect(map.get('사진 등록 기업 수')).toBe(1);
    expect(map.get('전체 사진 수')).toBe(3);
  });
});

describe('buildExpertSurveySheet', () => {
  const questions = [
    { id: 'q1', order_no: 1, title: '만족도', question_type: 'RATING' },
  ] as SurveyQuestion[];
  const userById = new Map<string, AssignableUser>([
    ['A', { id: 'A', role: 'STARTUP', name: '가기업', company_name: '가기업' } as AssignableUser],
    ['X', { id: 'X', role: 'EXPERT', name: '박전문' } as AssignableUser],
  ]);

  it('응답 기업·대상 전문가·문항 답변을 한 행으로', () => {
    const resp = [
      {
        id: '1',
        user_id: 'A',
        target_expert_id: 'X',
        slot_id: 's',
        submitted_at: '2026-07-01T00:00:00Z',
        answers: [{ question_id: 'q1', answer_rating: 5, answer_text: null, answer_selections: null }],
      },
    ] as ExpertResponse[];
    const sheet = buildExpertSurveySheet(questions, resp, userById, 'UTC');
    expect(sheet.columns.map((c) => c.header)).toEqual(['제출 시각', '응답 기업', '대상 전문가', '만족도']);
    const row = sheet.rows[0];
    expect(row[1]).toBe('가기업');
    expect(row[2]).toContain('박전문');
    expect(row[3]).toBe('5');
  });
});

describe('zip 경로 헬퍼', () => {
  it('sanitizeSegment 가 경로구분·금지문자를 공백으로 치환', () => {
    expect(sanitizeSegment('가/나:다*라')).toBe('가 나 다 라');
  });

  it('빈 결과는 fallback', () => {
    expect(sanitizeSegment('///', 'X')).toBe('X');
  });

  it('companyFolderName 은 기업명, 빈 이름이면 userId 앞 8자', () => {
    expect(companyFolderName({ userId: 'abcdef12-xxxx', companyName: '', contactName: '' })).toBe(
      'abcdef12',
    );
  });

  it('extFromPath 는 원본명 > 경로 순, 없으면 jpg', () => {
    expect(extFromPath('event-photos/e/A/1.png', '현장.JPG')).toBe('jpg');
    expect(extFromPath('event-photos/e/A/1.png', null)).toBe('png');
    expect(extFromPath('event-photos/e/A/noext', null)).toBe('jpg');
  });

  it('bundlePhotoName 은 기업명_행사명_증빙사진_행사일자_n 규칙으로, n 을 1부터 증가시킨다', () => {
    const used = new Set<string>();
    const common = {
      used,
      companyName: '페이로직',
      eventTitle: '청년 페어',
      eventDate: '2026-07-01',
    };
    const a = bundlePhotoName({ ...common, storagePath: 'p/1.jpg', originalName: '현장.jpg' });
    const b = bundlePhotoName({ ...common, storagePath: 'p/2.png', originalName: null });
    expect(a).toBe('페이로직_청년 페어_증빙사진_2026-07-01_1.jpg');
    expect(b).toBe('페이로직_청년 페어_증빙사진_2026-07-01_2.png');
  });

  it('bundlePhotoName 은 금지문자를 정리하고 빈 이름은 fallback', () => {
    const name = bundlePhotoName({
      used: new Set(),
      companyName: '가/나',
      eventTitle: '',
      eventDate: '2026-07-01',
      storagePath: 'p/1.webp',
      originalName: null,
    });
    expect(name).toBe('가 나_행사_증빙사진_2026-07-01_1.webp');
  });

  it('bundleFilename 형식', () => {
    expect(bundleFilename('A/B 페어', '2026-07-01')).toBe('산출물_A B 페어_2026-07-01.zip');
  });
});
