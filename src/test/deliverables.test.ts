import { describe, it, expect } from 'vitest';
import {
  buildDeliverableRows,
  summarizeDeliverables,
  type BuildDeliverableInput,
  type DeliverableLog,
} from '@/lib/deliverables';

/** 한 기업의 상담일지 행을 만든다(완료 + 일지 제출 여부 지정). */
function log(
  startupId: string,
  status: string,
  submitted: boolean,
): DeliverableLog {
  return {
    startup_id: startupId,
    session_status: status,
    submitted_at: submitted ? '2026-06-30T00:00:00Z' : null,
  };
}

function baseInput(over: Partial<BuildDeliverableInput> = {}): BuildDeliverableInput {
  return {
    companies: [{ userId: 'A', companyName: '가기업', contactName: '김담당' }],
    logs: [],
    eventResponses: [],
    expertResponses: [],
    photoCountByCompany: new Map(),
    satisfactionPolicy: 'NONE',
    ...over,
  };
}

describe('buildDeliverableRows — 상담횟수/일지 분모', () => {
  it('상담횟수는 완료/예약(취소 제외) 세션이고, 일지 분모는 완료 세션만이다', () => {
    const [row] = buildDeliverableRows(
      baseInput({
        logs: [
          log('A', 'COMPLETED', true), // 완료 + 일지 제출
          log('A', 'COMPLETED', false), // 완료 + 일지 미제출
          log('A', 'NO_SHOW', false), // 노쇼 — 상담횟수 분모엔 포함, 일지 분모엔 제외
          log('A', 'WAITING', false), // 대기 — 상담횟수 분모 포함
        ],
      }),
    );
    expect(row.sessions).toEqual({ done: 2, total: 4 });
    expect(row.logs).toEqual({ done: 1, total: 2 });
  });
});

describe('buildDeliverableRows — 만족도 정책 게이팅', () => {
  it('NONE 이면 행사·전문가 만족도 모두 null', () => {
    const [row] = buildDeliverableRows(baseInput({ satisfactionPolicy: 'NONE' }));
    expect(row.eventSurvey).toBeNull();
    expect(row.expertSurvey).toBeNull();
  });

  it('EVENT_ONLY 이면 행사 만족도만 집계(응답 시 1/1)', () => {
    const [row] = buildDeliverableRows(
      baseInput({
        satisfactionPolicy: 'EVENT_ONLY',
        eventResponses: [{ user_id: 'A' }],
      }),
    );
    expect(row.eventSurvey).toEqual({ done: 1, total: 1 });
    expect(row.expertSurvey).toBeNull();
  });

  it('EXPERT_ONLY 이면 완료 세션 수가 기대치이되, 응답이 더 많으면 응답 수까지 반영(분모=max)', () => {
    const [row] = buildDeliverableRows(
      baseInput({
        satisfactionPolicy: 'EXPERT_ONLY',
        logs: [log('A', 'COMPLETED', true), log('A', 'COMPLETED', true)],
        // 응답 3건은 완료 세션(2)보다 많아도 깎이지 않고, 분모를 3으로 올려 그대로 반영.
        expertResponses: [{ user_id: 'A' }, { user_id: 'A' }, { user_id: 'A' }],
      }),
    );
    expect(row.eventSurvey).toBeNull();
    expect(row.expertSurvey).toEqual({ done: 3, total: 3 });
  });

  it('완료 세션이 0이어도 저장된 응답은 그대로 반영(1/1)', () => {
    const [row] = buildDeliverableRows(
      baseInput({
        satisfactionPolicy: 'EXPERT_ONLY',
        // 진행 상태가 완료로 마킹되지 않은(또는 슬롯 없는) 상태에서 응답만 저장된 경우.
        logs: [],
        expertResponses: [{ user_id: 'A' }],
      }),
    );
    expect(row.expertSurvey).toEqual({ done: 1, total: 1 });
  });
});

describe('buildDeliverableRows — 최종 완료 판정', () => {
  it('모든 항목 충족 + 사진 ≥ 1장이면 완료', () => {
    const [row] = buildDeliverableRows(
      baseInput({
        satisfactionPolicy: 'BOTH',
        logs: [log('A', 'COMPLETED', true)],
        eventResponses: [{ user_id: 'A' }],
        expertResponses: [{ user_id: 'A' }],
        photoCountByCompany: new Map([['A', 2]]),
      }),
    );
    expect(row.complete).toBe(true);
  });

  it('다른 항목이 모두 충족돼도 사진이 0장이면 미완료', () => {
    const [row] = buildDeliverableRows(
      baseInput({
        satisfactionPolicy: 'BOTH',
        logs: [log('A', 'COMPLETED', true)],
        eventResponses: [{ user_id: 'A' }],
        expertResponses: [{ user_id: 'A' }],
        photoCountByCompany: new Map(), // 사진 없음
      }),
    );
    expect(row.complete).toBe(false);
  });

  it('일지 미제출이 남아 있으면 미완료', () => {
    const [row] = buildDeliverableRows(
      baseInput({
        satisfactionPolicy: 'NONE',
        logs: [log('A', 'COMPLETED', false)],
        photoCountByCompany: new Map([['A', 1]]),
      }),
    );
    expect(row.logs).toEqual({ done: 0, total: 1 });
    expect(row.complete).toBe(false);
  });
});

describe('buildDeliverableRows — 기업 정렬·요약', () => {
  it('기업명 오름차순 정렬', () => {
    const rows = buildDeliverableRows(
      baseInput({
        companies: [
          { userId: 'A', companyName: '나기업', contactName: '' },
          { userId: 'B', companyName: '가기업', contactName: '' },
        ],
      }),
    );
    expect(rows.map((r) => r.companyName)).toEqual(['가기업', '나기업']);
  });

  it('summarizeDeliverables 가 완료/미완료 개사를 센다', () => {
    const rows = buildDeliverableRows(
      baseInput({
        companies: [
          { userId: 'A', companyName: '가기업', contactName: '' },
          { userId: 'B', companyName: '나기업', contactName: '' },
        ],
        satisfactionPolicy: 'NONE',
        logs: [log('A', 'COMPLETED', true)],
        photoCountByCompany: new Map([['A', 1]]),
      }),
    );
    const summary = summarizeDeliverables(rows);
    expect(summary).toEqual({ total: 2, complete: 1, incomplete: 1 });
  });
});
