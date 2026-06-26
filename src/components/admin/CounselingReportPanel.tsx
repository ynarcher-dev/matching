import { useMemo } from 'react';
import { Card } from '@/components/common/Card';
import { Alert } from '@/components/common/Alert';
import { Button } from '@/components/common/Button';
import { Spinner } from '@/components/common/Spinner';
import { useEventCounselingQuestions } from '@/hooks/useCounselingBuilder';
import { useCounselingReport } from '@/hooks/useCounselingReport';
import { answerToDisplay, ratingAverage, toCsv } from '@/lib/counselingReport';
import { formatDateTime } from '@/lib/datetime';
import type { CounselingAnswerRow } from '@/types/counselingLog';
import type { AssignableUser, EventParticipantRow } from '@/types/eventDetail';

const SESSION_STATUS_LABEL: Record<string, string> = {
  WAITING: '대기',
  IN_PROGRESS: '진행 중',
  COMPLETED: '완료',
  NO_SHOW: '불참',
  CANCELLED: '취소',
};

function expertOrg(u: AssignableUser | undefined): string {
  if (!u) return '(알 수 없음)';
  return u.expert_organization ?? '';
}
function startupName(u: AssignableUser | undefined): string {
  if (!u) return '(알 수 없음)';
  return u.company_name ?? u.name;
}

/**
 * 상담일지 결과 리포트 패널 (관리자 행사 상세 — 상담일지 결과 탭).
 * 출처: docs/counseling_log_customization.md §8.3.
 * 작성 현황 + 평점 문항 평균 + CSV 내보내기(행=counseling_logs + matching_slots).
 */
export function CounselingReportPanel({
  eventId,
  eventTitle,
  userById,
  timezone,
}: {
  eventId: string;
  eventTitle: string;
  participants: EventParticipantRow[];
  userById: Map<string, AssignableUser>;
  timezone: string;
}) {
  const questionsQ = useEventCounselingQuestions(eventId);
  const reportQ = useCounselingReport(eventId);

  const questions = useMemo(
    () => (questionsQ.data ?? []).slice().sort((a, b) => a.order_no - b.order_no),
    [questionsQ.data],
  );
  const logs = useMemo(() => reportQ.data ?? [], [reportQ.data]);
  const completed = logs.filter((l) => l.session_status === 'COMPLETED');

  // 문항별 답변 모음(평점 평균용).
  const answersByQuestion = useMemo(() => {
    const m = new Map<string, CounselingAnswerRow[]>();
    for (const l of logs) {
      for (const a of l.answers) {
        const arr = m.get(a.question_id) ?? [];
        arr.push(a);
        m.set(a.question_id, arr);
      }
    }
    return m;
  }, [logs]);

  const handleExport = () => {
    const headers = [
      '행사명',
      '상담 일시',
      '전문가 소속',
      '스타트업',
      '세션 상태',
      '제출 시각',
      '후속 연계',
      '후속 메모',
      ...questions.map((q) => q.title),
    ];
    const rows = logs.map((l) => {
      const expert = l.expert_id ? userById.get(l.expert_id) : undefined;
      const startup = l.startup_id ? userById.get(l.startup_id) : undefined;
      const ansMap = new Map(l.answers.map((a) => [a.question_id, a]));
      return [
        eventTitle,
        l.start_time ? formatDateTime(l.start_time, timezone) : '',
        expert?.name ? `${expert.name} (${expertOrg(expert)})` : expertOrg(expert),
        startupName(startup),
        SESSION_STATUS_LABEL[l.session_status] ?? l.session_status,
        l.session_status === 'COMPLETED' && l.submitted_at ? formatDateTime(l.submitted_at, timezone) : '',
        l.follow_up_required ? '필요' : '',
        l.follow_up_memo ?? '',
        ...questions.map((q) => answerToDisplay(q, ansMap.get(q.id))),
      ];
    });
    const csv = toCsv(headers, rows);
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `상담일지결과_${eventTitle}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (questionsQ.isLoading || reportQ.isLoading) {
    return (
      <Card className="flex items-center justify-center p-8">
        <Spinner className="h-5 w-5" />
      </Card>
    );
  }

  const ratingQuestions = questions.filter((q) => q.question_type === 'RATING');

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-bold text-neutral-base">상담일지 결과</h2>
        <p className="text-sm text-neutral-base/70">
          전문가가 작성한 상담일지를 집계합니다. CSV 로 내려받아 외부 보고에 활용할 수 있습니다.
        </p>
      </div>

      {(questionsQ.isError || reportQ.isError) && (
        <Alert tone="error">결과를 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.</Alert>
      )}

      {/* 작성 현황 + 내보내기 */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3">
        <div className="flex flex-col">
          <span className="text-sm text-neutral-base/70">작성 완료</span>
          <span className="text-lg font-bold text-neutral-base">
            {completed.length}건 <span className="text-neutral-base/50">/ 일지 {logs.length}건</span>
          </span>
        </div>
        <Button variant="outline" onClick={handleExport} disabled={logs.length === 0}>
          CSV 내보내기
        </Button>
      </div>

      {/* 평점 문항 평균 */}
      {ratingQuestions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {ratingQuestions.map((q) => {
            const avg = ratingAverage(answersByQuestion.get(q.id) ?? []);
            return (
              <span
                key={q.id}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-sm text-neutral-base"
              >
                {q.title}
                <span className="font-bold text-brand">{avg != null ? avg.toFixed(2) : '–'}</span>
                <span className="text-xs text-neutral-base/50">/ 5</span>
              </span>
            );
          })}
        </div>
      )}

      {/* 상담일지 목록 */}
      {logs.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-sm text-neutral-base/60">
          아직 작성된 상담일지가 없습니다.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {logs.map((l) => {
            const expert = l.expert_id ? userById.get(l.expert_id) : undefined;
            const startup = l.startup_id ? userById.get(l.startup_id) : undefined;
            return (
              <div
                key={l.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-4 py-3"
              >
                <div className="flex flex-col">
                  <span className="text-sm font-bold text-neutral-base">
                    {startupName(startup)}
                    <span className="ml-2 text-xs font-normal text-neutral-base/60">
                      {expert?.name ?? ''} {expertOrg(expert) && `· ${expertOrg(expert)}`}
                    </span>
                  </span>
                  <span className="text-xs text-neutral-base/60">
                    {l.start_time ? formatDateTime(l.start_time, timezone) : ''}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  {l.follow_up_required && (
                    <span className="rounded-full bg-brand/10 px-2 py-0.5 font-semibold text-brand">
                      후속 연계
                    </span>
                  )}
                  <span
                    className={`rounded-full px-2 py-0.5 font-semibold ${
                      l.session_status === 'COMPLETED'
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-muted text-neutral-base/60'
                    }`}
                  >
                    {SESSION_STATUS_LABEL[l.session_status] ?? l.session_status}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
