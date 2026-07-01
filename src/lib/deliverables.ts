/**
 * 산출물 관리(행사 상세) 집계 순수 함수.
 * 기업(스타트업) 1행에 대해 상담·일지·만족도·사진의 충족 현황과 최종 완료 여부를 계산한다.
 * (booking.ts / companyPhoto.ts 와 동일한 "화면이 호출하는 계산 로직을 분리해 단위 테스트" 패턴.)
 *
 * 데이터 출처(모두 기존 훅 재사용):
 *  - 세션·일지: useCounselingReport(ReportCounselingLog) — 쿼리가 이미 예약(취소 제외) 세션 집합.
 *  - 행사 만족도: useSurveyReport(STARTUP 응답, user_id 매칭).
 *  - 전문가 만족도: useExpertSurveyReport(스타트업 user_id 기준 집계).
 *  - 사진: useEventCompanyPhotos(company_user_id 별 장수).
 *  - 수집 정책: events.satisfaction_policy 로 만족도 집계 여부를 게이팅.
 */

import type { SatisfactionPolicy } from '@/types/event';

/** 한 산출물 항목의 충족도(완료 수 / 기대 수). */
export interface DeliverableMetric {
  done: number;
  total: number;
}

/** 산출물 표 1행(기업 단위). */
export interface DeliverableRow {
  userId: string;
  companyName: string;
  contactName: string;
  /** 상담횟수 = 완료(COMPLETED) / 예약(취소 제외) 세션. */
  sessions: DeliverableMetric;
  /** 일지 = 제출(submitted_at≠null) / 완료 세션. */
  logs: DeliverableMetric;
  /** 행사 만족도 = 응답(1) / 1. 정책상 미수집이면 null. */
  eventSurvey: DeliverableMetric | null;
  /** 전문가 만족도 = 응답 수 / max(완료 세션 수, 응답 수). 저장된 응답은 세션과 무관하게 반영. 정책상 미수집이면 null. */
  expertSurvey: DeliverableMetric | null;
  /** 증빙사진 장수. */
  photoCount: number;
  /** 최종 여부 — 모든 (해당) 항목 충족 + 사진 ≥ 1장. */
  complete: boolean;
}

/** 집계 대상 기업(스타트업). */
export interface DeliverableCompany {
  userId: string;
  companyName: string;
  contactName: string;
}

/** 세션·일지 계산에 필요한 상담일지 행의 부분 집합. */
export type DeliverableLog = {
  startup_id: string | null;
  session_status: string;
  submitted_at: string | null;
};

/** 만족도 응답에서 필요한 식별자(스타트업 user_id). */
export type DeliverableResponse = { user_id: string };

export interface BuildDeliverableInput {
  companies: DeliverableCompany[];
  /** 예약(취소 제외) 세션 행 — useCounselingReport 결과. */
  logs: DeliverableLog[];
  /** 행사 만족도(EVENT 스코프) 응답 — STARTUP 응답으로 이미 필터된 목록. */
  eventResponses: DeliverableResponse[];
  /** 전문가 만족도(EXPERT 스코프) 응답 — 참가 스타트업/전문가로 이미 필터된 목록. */
  expertResponses: DeliverableResponse[];
  /** company_user_id → 사진 장수. */
  photoCountByCompany: Map<string, number>;
  satisfactionPolicy: SatisfactionPolicy;
}

const COMPLETED = 'COMPLETED';

/** 정책상 행사 만족도를 수집하는가. */
function collectsEventSurvey(policy: SatisfactionPolicy): boolean {
  return policy === 'EVENT_ONLY' || policy === 'BOTH';
}
/** 정책상 전문가 만족도를 수집하는가. */
function collectsExpertSurvey(policy: SatisfactionPolicy): boolean {
  return policy === 'EXPERT_ONLY' || policy === 'BOTH';
}

/** 항목 충족 여부 — 기대치가 0이면(요구 없음) 충족으로 본다. null 항목(미수집)도 통과. */
export function isMetricMet(metric: DeliverableMetric | null): boolean {
  if (metric === null) return true;
  return metric.total === 0 || metric.done >= metric.total;
}

/**
 * 기업별 산출물 현황을 만든다(순수 함수). 기업명 오름차순 정렬(buildCompanyStatuses 와 동일 컨벤션).
 */
export function buildDeliverableRows(input: BuildDeliverableInput): DeliverableRow[] {
  const {
    companies,
    logs,
    eventResponses,
    expertResponses,
    photoCountByCompany,
    satisfactionPolicy,
  } = input;

  const eventCollected = collectsEventSurvey(satisfactionPolicy);
  const expertCollected = collectsExpertSurvey(satisfactionPolicy);

  // 응답 집계: 스타트업 user_id 기준.
  const eventResponded = new Set(eventResponses.map((r) => r.user_id));
  const expertResponseCount = new Map<string, number>();
  for (const r of expertResponses) {
    expertResponseCount.set(r.user_id, (expertResponseCount.get(r.user_id) ?? 0) + 1);
  }

  // 세션·일지 집계: 기업별로 한 번만 순회.
  const sessionAgg = new Map<string, { booked: number; completed: number; logsSubmitted: number }>();
  for (const l of logs) {
    if (!l.startup_id) continue;
    const cur = sessionAgg.get(l.startup_id) ?? { booked: 0, completed: 0, logsSubmitted: 0 };
    cur.booked += 1;
    if (l.session_status === COMPLETED) {
      cur.completed += 1;
      // 일지는 완료된 상담에 대해서만 기대한다(no-show 세션은 분모에서 제외).
      if (l.submitted_at) cur.logsSubmitted += 1;
    }
    sessionAgg.set(l.startup_id, cur);
  }

  return companies
    .map((c) => {
      const agg = sessionAgg.get(c.userId) ?? { booked: 0, completed: 0, logsSubmitted: 0 };
      const sessions: DeliverableMetric = { done: agg.completed, total: agg.booked };
      const logsMetric: DeliverableMetric = { done: agg.logsSubmitted, total: agg.completed };

      const eventSurvey: DeliverableMetric | null = eventCollected
        ? { done: eventResponded.has(c.userId) ? 1 : 0, total: 1 }
        : null;

      const expertResp = expertResponseCount.get(c.userId) ?? 0;
      const expertSurvey: DeliverableMetric | null = expertCollected
        ? {
            // 저장된 응답은 세션 완료 여부와 무관하게 그대로 반영한다(분자 = 응답 수, 깎지 않음).
            // 기대치는 완료 세션 수가 기본이되, 응답이 그보다 많으면 응답 수를 기대치로 올려
            // (분모 = max) 저장된 응답이 분자에서 잘려 보이지 않는 일을 막는다.
            done: expertResp,
            total: Math.max(agg.completed, expertResp),
          }
        : null;

      const photoCount = photoCountByCompany.get(c.userId) ?? 0;

      const complete =
        isMetricMet(sessions) &&
        isMetricMet(logsMetric) &&
        isMetricMet(eventSurvey) &&
        isMetricMet(expertSurvey) &&
        photoCount >= 1;

      return {
        userId: c.userId,
        companyName: c.companyName,
        contactName: c.contactName,
        sessions,
        logs: logsMetric,
        eventSurvey,
        expertSurvey,
        photoCount,
        complete,
      } satisfies DeliverableRow;
    })
    .sort((a, b) => a.companyName.localeCompare(b.companyName, 'ko'));
}

/** 산출물 표 전체 요약(완료/미완료 개사). */
export function summarizeDeliverables(rows: DeliverableRow[]): {
  total: number;
  complete: number;
  incomplete: number;
} {
  const complete = rows.filter((r) => r.complete).length;
  return { total: rows.length, complete, incomplete: rows.length - complete };
}
