/**
 * 산출물 일괄 다운로드(ZIP) — 선택 기업 데이터 필터·시트·zip 경로 순수 함수.
 * 출처: docs/artifact_management_ideation.md (운영관리 탭 통합 — 체크박스 태그 선택 → ZIP).
 *
 * ZIP 구조(데이터 통합 + 사진 폴더):
 *   산출물_{행사명}_{날짜}.zip
 *     +- 산출물_데이터.xlsx        (선택 기업 전체 통합: 요약·상담일지·행사만족도·전문가만족도)
 *     +- 사진/{기업명}/...jpg      (사진 있는 기업만 폴더 생성)
 *
 * 조회·xlsx 직렬화·사진 다운로드·zip 압축은 hooks/useArtifactBundle 가 담당하고,
 * 여기서는 "선택 기업으로의 데이터 필터 + 시트 표 구조 + zip 안전 경로"만 순수 함수로 만든다.
 */

import type { SheetSpec } from '@/lib/excel';
import type { AssignableUser } from '@/types/eventDetail';
import type { SurveyQuestion } from '@/types/satisfaction';
import type { ReportCounselingLog } from '@/hooks/useCounselingReport';
import type { ReportResponse } from '@/hooks/useSurveyReport';
import type { ExpertResponse } from '@/lib/expertSurveyReport';
import { formatDateTime } from '@/lib/datetime';
import { answerToDisplay as surveyAnswerToDisplay } from '@/lib/surveyReport';
import { participantLabel } from '@/lib/labels';

/** 선택 기업(태그 1개). */
export interface BundleCompany {
  userId: string;
  companyName: string;
  contactName: string;
}

/** 사용자 id → 표시 호칭(없으면 빈/미상). */
function nameOf(userById: Map<string, AssignableUser>, id: string | null): string {
  if (!id) return '';
  const u = userById.get(id);
  return u ? participantLabel(u) : '(알 수 없음)';
}

/** 빈/이상 ISO 는 빈 문자열(formatDateTime 의 Invalid Date 방지). */
function safeDateTime(iso: string | null, tz: string): string {
  return iso ? formatDateTime(iso, tz) : '';
}

// 선택 기업으로의 필터 -------------------------------------------------

/** 상담일지 — 선택 기업(startup_id) 한정. */
export function filterCounselingLogs(
  logs: ReportCounselingLog[],
  ids: Set<string>,
): ReportCounselingLog[] {
  return logs.filter((l) => l.startup_id != null && ids.has(l.startup_id));
}

/** 행사 만족도(EVENT) — 선택 기업(STARTUP 응답) 한정. */
export function filterEventResponses(
  responses: ReportResponse[],
  ids: Set<string>,
): ReportResponse[] {
  return responses.filter((r) => r.user_role === 'STARTUP' && ids.has(r.user_id));
}

/** 전문가 만족도(EXPERT) — 선택 기업이 응답자(user_id)인 응답 한정. */
export function filterExpertResponses(
  responses: ExpertResponse[],
  ids: Set<string>,
): ExpertResponse[] {
  return responses.filter((r) => ids.has(r.user_id));
}

// 시트 ------------------------------------------------------------------

/** ① 요약 — 선택 기업·데이터·사진 건수. */
export function buildArtifactSummarySheet(input: {
  eventTitle: string;
  companies: BundleCompany[];
  photoCountByCompany: Map<string, number>;
  counselingCount: number;
  eventSurveyCount: number;
  expertSurveyCount: number;
}): SheetSpec {
  const totalPhotos = input.companies.reduce(
    (sum, c) => sum + (input.photoCountByCompany.get(c.userId) ?? 0),
    0,
  );
  const companiesWithPhotos = input.companies.filter(
    (c) => (input.photoCountByCompany.get(c.userId) ?? 0) > 0,
  ).length;

  return {
    name: '요약',
    columns: [
      { header: '항목', width: 24 },
      { header: '값', width: 40 },
    ],
    rows: [
      ['행사명', input.eventTitle],
      ['선택 기업 수', input.companies.length],
      ['상담일지 건수', input.counselingCount],
      ['행사 만족도 응답 수', input.eventSurveyCount],
      ['전문가 만족도 응답 수', input.expertSurveyCount],
      ['사진 등록 기업 수', companiesWithPhotos],
      ['전체 사진 수', totalPhotos],
    ],
  };
}

/** ② 전문가 만족도 — 응답 1건당 1행(응답 기업 + 대상 전문가 + 문항 펼침). */
export function buildExpertSurveySheet(
  questions: SurveyQuestion[],
  responses: ExpertResponse[],
  userById: Map<string, AssignableUser>,
  tz: string,
): SheetSpec {
  const sorted = [...questions].sort((a, b) => a.order_no - b.order_no);
  return {
    name: '전문가 만족도',
    columns: [
      { header: '제출 시각', width: 18 },
      { header: '응답 기업', width: 28 },
      { header: '대상 전문가', width: 24 },
      ...sorted.map((q) => ({ header: q.title, width: 20 })),
    ],
    rows: responses.map((resp) => {
      const byQid = new Map(resp.answers.map((a) => [a.question_id, a]));
      return [
        safeDateTime(resp.submitted_at, tz),
        nameOf(userById, resp.user_id),
        nameOf(userById, resp.target_expert_id),
        ...sorted.map((q) => surveyAnswerToDisplay(q, byQid.get(q.id))),
      ];
    }),
  };
}

// ZIP 경로 --------------------------------------------------------------

/** 파일시스템/zip 금지문자(경로구분 포함). */
const ZIP_BAD_CHARS = /[\\/:*?"<>|]/g;

/** zip 폴더/파일명 안전화 — 경로구분·금지문자 제거, 공백 정리, 길이 제한. */
export function sanitizeSegment(name: string, fallback = '무제'): string {
  const safe = name.replace(ZIP_BAD_CHARS, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  return safe || fallback;
}

/** 기업 폴더명(중복 기업명은 호출부에서 userId 접미로 구분). */
export function companyFolderName(company: BundleCompany): string {
  return sanitizeSegment(company.companyName, company.userId.slice(0, 8));
}

/** 객체 경로/원본명에서 확장자를 뽑는다(없으면 jpg). */
export function extFromPath(path: string, originalName: string | null): string {
  const src = originalName || path;
  const m = src.match(/\.([a-zA-Z0-9]{1,5})$/);
  return (m?.[1] ?? 'jpg').toLowerCase();
}

/**
 * 사진 파일명 규칙: `기업명_행사명_증빙사진_행사일자_n.ext`.
 * 한 기업 폴더 안의 사진은 base(기업명_행사명_증빙사진_행사일자)가 모두 같으므로
 * n(1부터 증가)을 붙여 구분한다. used 집합으로 충돌을 회피하며 갱신한다.
 */
export function bundlePhotoName(input: {
  used: Set<string>;
  companyName: string;
  eventTitle: string;
  /** 행사일자(YYYY-MM-DD, 행사 timezone 기준). */
  eventDate: string;
  storagePath: string;
  originalName: string | null;
}): string {
  const ext = extFromPath(input.storagePath, input.originalName);
  const base = [
    sanitizeSegment(input.companyName, '기업'),
    sanitizeSegment(input.eventTitle, '행사'),
    '증빙사진',
    input.eventDate,
  ].join('_');
  // n 은 폴더 내 누적 개수 기준으로 1,2,3… 순차 부여(확장자가 달라도 번호가 이어진다).
  let n = input.used.size + 1;
  let name = `${base}_${n}.${ext}`;
  while (input.used.has(name.toLowerCase())) {
    n += 1;
    name = `${base}_${n}.${ext}`;
  }
  input.used.add(name.toLowerCase());
  return name;
}

/** ZIP 파일명: "산출물_{행사명}_{날짜}.zip". */
export function bundleFilename(title: string, dateStr: string): string {
  return `산출물_${sanitizeSegment(title, '행사')}_${dateStr}.zip`;
}
