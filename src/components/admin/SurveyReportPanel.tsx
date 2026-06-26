import { useMemo, useState } from 'react';
import { Card } from '@/components/common/Card';
import { Alert } from '@/components/common/Alert';
import { Button } from '@/components/common/Button';
import { Spinner } from '@/components/common/Spinner';
import { useEventSurveyQuestions } from '@/hooks/useSurveyBuilder';
import { useSurveyReport } from '@/hooks/useSurveyReport';
import {
  aggregateQuestion,
  answerToDisplay,
  responseRate,
  toCsv,
  type QuestionAgg,
} from '@/lib/surveyReport';
import { barWidthClass } from '@/lib/percentBar';
import { QUESTION_TYPE_LABEL, RATING_SCALE } from '@/lib/satisfaction';
import { PARTICIPANT_ROLE_LABELS } from '@/lib/labels';
import { formatDateTime } from '@/lib/datetime';
import type {
  SurveyAnswerRow,
  SurveyQuestion,
  SurveyTargetRole,
} from '@/types/satisfaction';
import type { AssignableUser, EventParticipantRow } from '@/types/eventDetail';

const ROLE_TABS: { value: Exclude<SurveyTargetRole, 'ALL'>; label: string }[] = [
  { value: 'STARTUP', label: '스타트업' },
  { value: 'EXPERT', label: '전문가' },
];

/** 가로 막대 + 수치(평점 분포·객관식 비율 공용). */
function StatBar({ label, count, pct }: { label: string; count: number; pct: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-24 shrink-0 truncate text-xs text-neutral-base/80">{label}</span>
      <div className="h-3 flex-1 overflow-hidden rounded-full bg-surface">
        <div className={`h-full rounded-full bg-brand ${barWidthClass(pct)}`} />
      </div>
      <span className="w-16 shrink-0 text-right text-xs text-neutral-base/70">
        {count}명 ({pct}%)
      </span>
    </div>
  );
}

/** 문항 1개 집계 시각화. */
function QuestionResult({ q, agg }: { q: SurveyQuestion; agg: QuestionAgg }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-semibold text-neutral-base/70">
          {QUESTION_TYPE_LABEL[q.question_type]}
        </span>
        <span className="text-sm font-bold text-neutral-base">{q.title}</span>
      </div>

      {agg.kind === 'RATING' && (
        <div className="flex flex-col gap-1.5">
          <p className="text-sm text-neutral-base/80">
            평균 <span className="font-bold text-brand">{agg.average.toFixed(2)}</span> / 5 · 응답 {agg.count}명
          </p>
          {RATING_SCALE.map((score) => {
            const cnt = agg.distribution[score - 1];
            const pct = agg.count > 0 ? Math.round((cnt / agg.count) * 100) : 0;
            return <StatBar key={score} label={`${score}점`} count={cnt} pct={pct} />;
          })}
        </div>
      )}

      {agg.kind === 'CHOICE' && (
        <div className="flex flex-col gap-1.5">
          <p className="text-sm text-neutral-base/80">
            응답 {agg.responders}명{agg.multiple && ' · 복수 선택'}
          </p>
          {agg.options.map((o) => (
            <StatBar key={o.label} label={o.label} count={o.count} pct={o.pct} />
          ))}
        </div>
      )}

      {agg.kind === 'TEXT' && (
        <div className="flex flex-col gap-1.5">
          <p className="text-sm text-neutral-base/80">응답 {agg.answers.length}건</p>
          {agg.answers.length === 0 ? (
            <p className="text-sm text-neutral-base/50">아직 응답이 없습니다.</p>
          ) : (
            agg.answers.map((t, i) => (
              <p
                key={i}
                className="whitespace-pre-wrap rounded-lg border border-border bg-surface px-3 py-2 text-sm text-neutral-base/90"
              >
                {t}
              </p>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/** 응답자 식별 컬럼(기업/소속, 성명). */
function respondentOrg(u: AssignableUser | undefined, role: 'STARTUP' | 'EXPERT'): string {
  if (!u) return '(알 수 없음)';
  if (role === 'STARTUP') return u.company_name ?? u.name;
  return u.expert_organization ?? '';
}
function respondentName(u: AssignableUser | undefined, role: 'STARTUP' | 'EXPERT'): string {
  if (!u) return '';
  if (role === 'STARTUP') return u.representative_name ?? u.name;
  return u.name;
}

/**
 * 만족도 조사 결과 리포트 패널 (관리자 행사 상세 — 만족도 결과 탭).
 * 출처: docs/survey_customization_ideation.md §3.2, §5.
 * 응답률 + 문항별 집계(평점 분포·객관식 비율·주관식 목록) + CSV 내보내기.
 */
export function SurveyReportPanel({
  eventId,
  participants,
  userById,
  timezone,
}: {
  eventId: string;
  participants: EventParticipantRow[];
  userById: Map<string, AssignableUser>;
  timezone: string;
}) {
  const questionsQ = useEventSurveyQuestions(eventId);
  const reportQ = useSurveyReport(eventId);

  const [role, setRole] = useState<'STARTUP' | 'EXPERT'>('STARTUP');

  const questions = useMemo(
    () =>
      (questionsQ.data ?? [])
        .filter((q) => q.target_role === role || q.target_role === 'ALL')
        .sort((a, b) => a.order_no - b.order_no),
    [questionsQ.data, role],
  );

  const responses = useMemo(
    () => (reportQ.data ?? []).filter((r) => r.user_role === role),
    [reportQ.data, role],
  );

  // 문항별 답변 모음(집계용).
  const answersByQuestion = useMemo(() => {
    const m = new Map<string, SurveyAnswerRow[]>();
    for (const r of responses) {
      for (const a of r.answers) {
        const arr = m.get(a.question_id) ?? [];
        arr.push(a);
        m.set(a.question_id, arr);
      }
    }
    return m;
  }, [responses]);

  const totalForRole = useMemo(
    () =>
      participants.filter(
        (p) => p.participant_type === role,
      ).length,
    [participants, role],
  );
  const rate = responseRate(totalForRole, responses.length);

  const handleExport = () => {
    const headers = ['제출 시각', '유형', '기업/소속', '성명', ...questions.map((q) => q.title)];
    const rows = responses.map((r) => {
      const u = userById.get(r.user_id);
      const ansMap = new Map(r.answers.map((a) => [a.question_id, a]));
      return [
        formatDateTime(r.submitted_at, timezone),
        PARTICIPANT_ROLE_LABELS[role],
        respondentOrg(u, role),
        respondentName(u, role),
        ...questions.map((q) => answerToDisplay(q, ansMap.get(q.id))),
      ];
    });
    const csv = toCsv(headers, rows);
    // 엑셀 한글 깨짐 방지를 위해 UTF-8 BOM 부착.
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `만족도결과_${PARTICIPANT_ROLE_LABELS[role]}.csv`;
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

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-bold text-neutral-base">만족도 조사 결과</h2>
        <p className="text-sm text-neutral-base/70">
          제출된 응답을 문항별로 집계합니다. CSV 로 내려받아 외부 보고에 활용할 수 있습니다.
        </p>
      </div>

      {(questionsQ.isError || reportQ.isError) && (
        <Alert tone="error">결과를 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.</Alert>
      )}

      {/* 역할 탭 */}
      <div className="flex gap-1.5">
        {ROLE_TABS.map((t) => {
          const active = role === t.value;
          return (
            <button
              key={t.value}
              type="button"
              onClick={() => setRole(t.value)}
              className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors ${
                active
                  ? 'border-brand bg-brand text-white'
                  : 'border-border bg-white text-neutral-base hover:bg-surface'
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* 응답률 + 내보내기 */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3">
        <div className="flex flex-col">
          <span className="text-sm text-neutral-base/70">응답률</span>
          <span className="text-lg font-bold text-neutral-base">
            {rate.responded} / {rate.total}명{' '}
            <span className="text-brand">({rate.pct}%)</span>
          </span>
        </div>
        <Button variant="outline" onClick={handleExport} disabled={responses.length === 0}>
          CSV 내보내기
        </Button>
      </div>

      {/* 문항별 집계 */}
      {questions.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-sm text-neutral-base/60">
          이 유형의 설문 문항이 없습니다.
        </p>
      ) : responses.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-sm text-neutral-base/60">
          아직 제출된 응답이 없습니다.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {questions.map((q) => (
            <QuestionResult
              key={q.id}
              q={q}
              agg={aggregateQuestion(q, answersByQuestion.get(q.id) ?? [])}
            />
          ))}
        </div>
      )}
    </Card>
  );
}
