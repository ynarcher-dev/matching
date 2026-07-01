/**
 * 행사 결과 엑셀 내보내기 — 도메인 데이터 → 시트(SheetSpec) 변환 순수 함수 (Phase 7 슬라이스 3).
 * 출처: docs/overview.md(관리자 만족도 종합 엑셀·원데이터 다운로드).
 * 기존 화면 집계 로직(booking/attendance/counselingReport/surveyReport)을 재사용하고
 * 여기서는 "엑셀 시트 표 구조"로만 포장한다. xlsx 직렬화·다운로드는 lib/excel.ts 가 담당.
 */

import type { SheetSpec } from '@/lib/excel';
import type {
  AssignableUser,
  EventTable,
  MatchingSlotRow,
  SessionStatus,
} from '@/types/eventDetail';
import type { AttendanceLogRow, AttendanceStatus } from '@/types/attendance';
import type { CounselingQuestion } from '@/types/counselingLog';
import type { SurveyQuestion } from '@/types/satisfaction';
import type { ParticipantRole } from '@/types/user';
import type { ReportCounselingLog } from '@/hooks/useCounselingReport';
import type { ReportResponse } from '@/hooks/useSurveyReport';
import { formatDateTime } from '@/lib/datetime';
import { latestAttendanceMap, attendanceStatusFor } from '@/lib/attendance';
import { answerToDisplay as surveyAnswerToDisplay } from '@/lib/surveyReport';
import { answerToDisplay as counselingAnswerToDisplay } from '@/lib/counselingReport';
import {
  BOOKING_TYPE_LABELS,
  SESSION_STATUS_LABELS,
  PARTICIPANT_ROLE_LABELS,
  participantLabel,
} from '@/lib/labels';

/** 참가자 명단 시트에 쓰는 사용자 행(연락처 포함). */
export interface RosterUser {
  id: string;
  role: ParticipantRole;
  name: string;
  email: string;
  phone_number: string | null;
  company_name: string | null;
  representative_name: string | null;
  contact_name: string | null;
  expert_organization: string | null;
  expert_position: string | null;
  /** 스타트업 참고 URL(홈페이지·웹 IR). 명단 "참고링크" 열. 없으면 null. */
  company_homepage: string | null;
  /** 스타트업 사업소개서 PDF 의 Storage 객체 경로. 명단 "소개서 첨부" 열(O/X 판정). 없으면 null. */
  proposal_file_url: string | null;
}

/** 엑셀 내보내기에 필요한 데이터 묶음(훅이 조회해 채운다). */
export interface EventExportBundle {
  timezone: string;
  slots: MatchingSlotRow[];
  tables: EventTable[];
  userById: Map<string, AssignableUser>;
  attendanceLogs: AttendanceLogRow[];
  counselingQuestions: CounselingQuestion[];
  counselingLogs: ReportCounselingLog[];
  surveyQuestions: SurveyQuestion[];
  surveyResponses: ReportResponse[];
  roster: RosterUser[];
}

const ATTENDANCE_LABEL: Record<AttendanceStatus, string> = { PRESENT: '출석', ABSENT: '불참' };
const SURVEY_ROLE_PREFIX: Record<string, string> = { STARTUP: '스타트업', EXPERT: '전문가', ALL: '공통' };

function attendanceText(status: AttendanceStatus | null): string {
  return status ? ATTENDANCE_LABEL[status] : '미정';
}

/** 빈/이상 ISO 는 빈 문자열로(formatDateTime 의 Invalid Date 방지). */
function safeDateTime(iso: string | null, tz: string): string {
  return iso ? formatDateTime(iso, tz) : '';
}

/** 사용자 id → 표시 호칭(없으면 빈/미상). */
function nameOf(userById: Map<string, AssignableUser>, id: string | null): string {
  if (!id) return '';
  const u = userById.get(id);
  return u ? participantLabel(u) : '(알 수 없음)';
}

function sessionStatusText(status: string): string {
  return SESSION_STATUS_LABELS[status as SessionStatus] ?? status;
}

/** ① 예약 현황 — 슬롯 1건당 1행. */
export function buildBookingSheet(
  slots: MatchingSlotRow[],
  userById: Map<string, AssignableUser>,
  tables: EventTable[],
  tz: string,
): SheetSpec {
  const tableCode = new Map(tables.map((t) => [t.id, t.table_code]));
  return {
    name: '예약 현황',
    columns: [
      { header: '시작 시각', width: 18 },
      { header: '종료 시각', width: 18 },
      { header: '테이블', width: 12 },
      { header: '전문가', width: 24 },
      { header: '기업(스타트업)', width: 28 },
      { header: '예약 경로', width: 12 },
      { header: '세션 상태', width: 12 },
      { header: '상담 희망사항', width: 40 },
    ],
    rows: slots.map((s) => [
      safeDateTime(s.start_time, tz),
      safeDateTime(s.end_time, tz),
      s.table_id ? tableCode.get(s.table_id) ?? '' : '',
      nameOf(userById, s.expert_id),
      s.startup_id ? nameOf(userById, s.startup_id) : '(미예약)',
      BOOKING_TYPE_LABELS[s.booking_type],
      SESSION_STATUS_LABELS[s.session_status],
      s.counseling_request ?? '',
    ]),
  };
}

/** ② 출석 현황 — 예약된(스타트업 배정·취소 아님) 세션 1건당 1행. */
export function buildAttendanceSheet(
  slots: MatchingSlotRow[],
  attendanceLogs: AttendanceLogRow[],
  userById: Map<string, AssignableUser>,
  tables: EventTable[],
  tz: string,
): SheetSpec {
  const tableCode = new Map(tables.map((t) => [t.id, t.table_code]));
  const map = latestAttendanceMap(attendanceLogs);
  const booked = slots.filter((s) => s.startup_id && s.session_status !== 'CANCELLED');
  return {
    name: '출석 현황',
    columns: [
      { header: '시작 시각', width: 18 },
      { header: '테이블', width: 12 },
      { header: '전문가', width: 24 },
      { header: '전문가 출석', width: 12 },
      { header: '기업(스타트업)', width: 28 },
      { header: '기업 출석', width: 12 },
      { header: '세션 상태', width: 12 },
    ],
    rows: booked.map((s) => [
      safeDateTime(s.start_time, tz),
      s.table_id ? tableCode.get(s.table_id) ?? '' : '',
      nameOf(userById, s.expert_id),
      attendanceText(attendanceStatusFor(map, s.id, s.expert_id)),
      nameOf(userById, s.startup_id),
      attendanceText(attendanceStatusFor(map, s.id, s.startup_id)),
      SESSION_STATUS_LABELS[s.session_status],
    ]),
  };
}

/** ③ 상담 결과 — 상담일지 1건당 1행(동적 문항을 열로 펼침). */
export function buildCounselingSheet(
  questions: CounselingQuestion[],
  logs: ReportCounselingLog[],
  userById: Map<string, AssignableUser>,
  tz: string,
): SheetSpec {
  const sorted = [...questions].sort((a, b) => a.order_no - b.order_no);
  return {
    name: '상담 결과',
    columns: [
      { header: '시작 시각', width: 18 },
      { header: '전문가', width: 24 },
      { header: '기업(스타트업)', width: 28 },
      { header: '세션 상태', width: 12 },
      { header: '후속 연계', width: 10 },
      { header: '후속 메모', width: 30 },
      ...sorted.map((q) => ({ header: q.title, width: 20 })),
      { header: '코멘트 공개', width: 12 },
    ],
    rows: logs.map((log) => {
      const byQid = new Map(log.answers.map((a) => [a.question_id, a]));
      return [
        safeDateTime(log.start_time, tz),
        nameOf(userById, log.expert_id),
        nameOf(userById, log.startup_id),
        sessionStatusText(log.session_status),
        log.follow_up_required ? '필요' : '없음',
        log.follow_up_memo ?? '',
        ...sorted.map((q) => counselingAnswerToDisplay(q, byQid.get(q.id))),
        log.is_public ? '공개' : '비공개',
      ];
    }),
  };
}

/** ④ 만족도 결과 — 응답 1건당 1행(문항을 열로 펼침, 역할 무관 전 문항을 열로). */
export function buildSurveySheet(
  questions: SurveyQuestion[],
  responses: ReportResponse[],
  userById: Map<string, AssignableUser>,
  tz: string,
): SheetSpec {
  const sorted = [...questions].sort(
    (a, b) => a.target_role.localeCompare(b.target_role) || a.order_no - b.order_no,
  );
  return {
    name: '만족도 결과',
    columns: [
      { header: '제출 시각', width: 18 },
      { header: '역할', width: 10 },
      { header: '응답자', width: 28 },
      ...sorted.map((q) => ({
        header: `[${SURVEY_ROLE_PREFIX[q.target_role] ?? q.target_role}] ${q.title}`,
        width: 20,
      })),
    ],
    rows: responses.map((resp) => {
      const byQid = new Map(resp.answers.map((a) => [a.question_id, a]));
      return [
        safeDateTime(resp.submitted_at, tz),
        PARTICIPANT_ROLE_LABELS[resp.user_role],
        nameOf(userById, resp.user_id),
        ...sorted.map((q) => surveyAnswerToDisplay(q, byQid.get(q.id))),
      ];
    }),
  };
}

/** ⑤ 참가자 명단 — 행사 참가자(전문가/스타트업) 연락처. */
export function buildParticipantSheet(roster: RosterUser[]): SheetSpec {
  return {
    name: '참가자 명단',
    columns: [
      { header: '역할', width: 10 },
      { header: '이름', width: 16 },
      { header: '기업/소속', width: 28 },
      { header: '대표/직책', width: 18 },
      { header: '담당자', width: 16 },
      { header: '이메일', width: 28 },
      { header: '연락처', width: 18 },
      { header: '참고링크', width: 32 },
      { header: '소개서 첨부', width: 12 },
    ],
    rows: roster.map((u) => [
      PARTICIPANT_ROLE_LABELS[u.role],
      u.name,
      (u.role === 'STARTUP' ? u.company_name : u.expert_organization) ?? '',
      (u.role === 'STARTUP' ? u.representative_name : u.expert_position) ?? '',
      u.contact_name ?? '',
      u.email,
      u.phone_number ?? '',
      // 참고링크·소개서 첨부는 스타트업 프로필 컬럼(전문가는 빈칸).
      u.role === 'STARTUP' ? u.company_homepage ?? '' : '',
      u.role === 'STARTUP' ? (u.proposal_file_url ? 'O' : 'X') : '',
    ]),
  };
}

/** 번들을 5개 시트 명세로 변환한다(엑셀 탭 순서). */
export function buildEventExportSheets(bundle: EventExportBundle): SheetSpec[] {
  const { timezone: tz, userById } = bundle;
  return [
    buildBookingSheet(bundle.slots, userById, bundle.tables, tz),
    buildAttendanceSheet(bundle.slots, bundle.attendanceLogs, userById, bundle.tables, tz),
    buildCounselingSheet(bundle.counselingQuestions, bundle.counselingLogs, userById, tz),
    buildSurveySheet(bundle.surveyQuestions, bundle.surveyResponses, userById, tz),
    buildParticipantSheet(bundle.roster),
  ];
}

/** 다운로드 파일명: "행사명_결과_YYYY-MM-DD.xlsx"(파일명 금지문자 치환). */
export function exportFilename(title: string, dateStr: string): string {
  const safe = title.replace(/[\\/:*?"<>|]/g, '_').trim() || '행사';
  return `${safe}_결과_${dateStr}.xlsx`;
}
