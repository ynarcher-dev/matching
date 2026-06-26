import { describe, it, expect } from 'vitest';
import {
  buildAttendanceSheet,
  buildBookingSheet,
  buildCounselingSheet,
  buildEventExportSheets,
  buildParticipantSheet,
  buildSurveySheet,
  exportFilename,
  type EventExportBundle,
  type RosterUser,
} from '@/lib/eventExport';
import type { AssignableUser, EventTable, MatchingSlotRow } from '@/types/eventDetail';
import type { AttendanceLogRow } from '@/types/attendance';
import type { CounselingQuestion } from '@/types/counselingLog';
import type { SurveyQuestion } from '@/types/satisfaction';
import type { ReportCounselingLog } from '@/hooks/useCounselingReport';
import type { ReportResponse } from '@/hooks/useSurveyReport';

const TZ = 'Asia/Seoul';

const expertUser: AssignableUser = {
  id: 'X1',
  name: '김전문',
  role: 'EXPERT',
  company_name: null,
  representative_name: null,
  expert_organization: '벤처대학',
  expert_position: '교수',
};
const startupUser: AssignableUser = {
  id: 'S1',
  name: '대표님',
  role: 'STARTUP',
  company_name: '에이콘',
  representative_name: '홍길동',
  expert_organization: null,
  expert_position: null,
};
const userById = new Map<string, AssignableUser>([
  ['X1', expertUser],
  ['S1', startupUser],
]);

const tables: EventTable[] = [
  { id: 'T1', event_id: 'E', table_code: 'A-01', description: null, is_active: true },
];

function slot(p: Partial<MatchingSlotRow> & Pick<MatchingSlotRow, 'id'>): MatchingSlotRow {
  return {
    event_id: 'E',
    expert_id: 'X1',
    startup_id: 'S1',
    start_time: '2026-07-10T01:00:00.000Z',
    end_time: '2026-07-10T01:40:00.000Z',
    table_id: 'T1',
    booking_type: 'MANUAL',
    session_status: 'COMPLETED',
    ...p,
  };
}

describe('buildBookingSheet', () => {
  it('슬롯마다 한 행을 만들고 라벨·이름을 해석한다', () => {
    const sheet = buildBookingSheet([slot({ id: 's1' })], userById, tables, TZ);
    expect(sheet.name).toBe('예약 현황');
    expect(sheet.columns).toHaveLength(7);
    expect(sheet.rows).toHaveLength(1);
    const [start, , table, expert, company, route, status] = sheet.rows[0];
    expect(start).toBe('2026.07.10 10:00');
    expect(table).toBe('A-01');
    expect(expert).toBe('김전문 · 벤처대학');
    expect(company).toBe('에이콘 · 홍길동');
    expect(route).toBe('수동');
    expect(status).toBe('완료');
  });

  it('미예약 슬롯은 기업 칸에 (미예약) 표기', () => {
    const sheet = buildBookingSheet(
      [slot({ id: 's2', startup_id: null, booking_type: 'NONE', session_status: 'WAITING' })],
      userById,
      tables,
      TZ,
    );
    expect(sheet.rows[0][4]).toBe('(미예약)');
  });
});

describe('buildAttendanceSheet', () => {
  const logs: AttendanceLogRow[] = [
    {
      id: 'a1',
      matching_slot_id: 's1',
      user_id: 'S1',
      role_type: 'STARTUP',
      attendance_status: 'PRESENT',
      checked_in_at: '2026-07-10T01:05:00.000Z',
    },
  ];

  it('예약된 세션만 포함하고 출석 상태를 한글로 표기(없으면 미정)', () => {
    const sheet = buildAttendanceSheet(
      [
        slot({ id: 's1' }),
        slot({ id: 's2', startup_id: null }), // 미예약 → 제외
        slot({ id: 's3', session_status: 'CANCELLED' }), // 취소 → 제외
      ],
      logs,
      userById,
      tables,
      TZ,
    );
    expect(sheet.rows).toHaveLength(1);
    const row = sheet.rows[0];
    expect(row[3]).toBe('미정'); // 전문가 출석 기록 없음
    expect(row[5]).toBe('출석'); // 스타트업 PRESENT
  });
});

describe('buildCounselingSheet', () => {
  const questions: CounselingQuestion[] = [
    {
      id: 'q2',
      event_id: 'E',
      question_type: 'RATING',
      title: '기술성',
      description: null,
      options: null,
      is_required: true,
      order_no: 2,
      system_key: 'score_technology',
    },
    {
      id: 'q1',
      event_id: 'E',
      question_type: 'LONG_ANSWER',
      title: '총평',
      description: null,
      options: null,
      is_required: false,
      order_no: 1,
      system_key: 'content',
    },
  ];
  const log: ReportCounselingLog = {
    id: 'c1',
    submitted_at: '2026-07-10T02:00:00.000Z',
    follow_up_required: true,
    follow_up_memo: '투자 검토',
    is_public: true,
    expert_id: 'X1',
    startup_id: 'S1',
    start_time: '2026-07-10T01:00:00.000Z',
    session_status: 'COMPLETED',
    answers: [
      { question_id: 'q2', answer_text: null, answer_rating: 5, answer_selections: null },
      { question_id: 'q1', answer_text: '좋은 팀', answer_rating: null, answer_selections: null },
    ],
  };

  it('문항을 order_no 순서 열로 펼치고 답변을 매핑한다', () => {
    const sheet = buildCounselingSheet(questions, [log], userById, TZ);
    // 고정 6열 + 문항 2열 + 공개 1열 = 9열
    expect(sheet.columns).toHaveLength(9);
    expect(sheet.columns[6].header).toBe('총평'); // order_no 1 먼저
    expect(sheet.columns[7].header).toBe('기술성');
    const row = sheet.rows[0];
    expect(row[4]).toBe('필요'); // 후속 연계
    expect(row[5]).toBe('투자 검토'); // 후속 메모
    expect(row[6]).toBe('좋은 팀'); // 총평
    expect(row[7]).toBe('5'); // 기술성
    expect(row[8]).toBe('공개');
  });
});

describe('buildSurveySheet', () => {
  const questions: SurveyQuestion[] = [
    {
      id: 'sq1',
      event_id: 'E',
      target_role: 'STARTUP',
      question_type: 'RATING',
      title: '행사 만족도',
      description: null,
      options: null,
      is_required: true,
      order_no: 1,
    },
  ];
  const resp: ReportResponse = {
    id: 'r1',
    user_id: 'S1',
    user_role: 'STARTUP',
    submitted_at: '2026-07-10T03:00:00.000Z',
    answers: [{ question_id: 'sq1', answer_text: null, answer_rating: 4, answer_selections: null }],
  };

  it('역할 접두사가 붙은 문항 열과 응답자/답변을 만든다', () => {
    const sheet = buildSurveySheet(questions, [resp], userById, TZ);
    expect(sheet.columns).toHaveLength(4); // 제출시각·역할·응답자 + 문항 1
    expect(sheet.columns[3].header).toBe('[스타트업] 행사 만족도');
    const row = sheet.rows[0];
    expect(row[1]).toBe('스타트업');
    expect(row[2]).toBe('에이콘 · 홍길동');
    expect(row[3]).toBe('4');
  });
});

describe('buildParticipantSheet', () => {
  const roster: RosterUser[] = [
    {
      id: 'S1',
      role: 'STARTUP',
      name: '대표님',
      email: 's1@acme.com',
      phone_number: '01011112222',
      company_name: '에이콘',
      representative_name: '홍길동',
      contact_name: '김담당',
      expert_organization: null,
      expert_position: null,
    },
    {
      id: 'X1',
      role: 'EXPERT',
      name: '김전문',
      email: 'x1@univ.ac.kr',
      phone_number: null,
      company_name: null,
      representative_name: null,
      contact_name: null,
      expert_organization: '벤처대학',
      expert_position: '교수',
    },
  ];

  it('역할에 따라 기업/소속·대표/직책을 채운다', () => {
    const sheet = buildParticipantSheet(roster);
    expect(sheet.rows[0]).toEqual(['스타트업', '대표님', '에이콘', '홍길동', '김담당', 's1@acme.com', '01011112222']);
    expect(sheet.rows[1]).toEqual(['전문가', '김전문', '벤처대학', '교수', '', 'x1@univ.ac.kr', '']);
  });
});

describe('buildEventExportSheets', () => {
  it('5개 시트를 정해진 순서로 만든다', () => {
    const bundle: EventExportBundle = {
      timezone: TZ,
      slots: [],
      tables: [],
      userById: new Map(),
      attendanceLogs: [],
      counselingQuestions: [],
      counselingLogs: [],
      surveyQuestions: [],
      surveyResponses: [],
      roster: [],
    };
    const sheets = buildEventExportSheets(bundle);
    expect(sheets.map((s) => s.name)).toEqual([
      '예약 현황',
      '출석 현황',
      '상담 결과',
      '만족도 결과',
      '참가자 명단',
    ]);
  });
});

describe('exportFilename', () => {
  it('행사명_결과_날짜.xlsx 형식, 금지문자 치환', () => {
    expect(exportFilename('2026 매칭/데이', '2026-07-10')).toBe('2026 매칭_데이_결과_2026-07-10.xlsx');
  });

  it('빈 제목은 기본값 행사', () => {
    expect(exportFilename('   ', '2026-07-10')).toBe('행사_결과_2026-07-10.xlsx');
  });
});
