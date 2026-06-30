import { useMemo, useState } from 'react';
import { Badge } from '@/components/common/Badge';
import { Card } from '@/components/common/Card';
import { Alert } from '@/components/common/Alert';
import { Button } from '@/components/common/Button';
import { Spinner } from '@/components/common/Spinner';
import { StatBox } from '@/components/common/StatBox';
import { FilterBar, SearchInput, FilterChips } from '@/components/common/FilterBar';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useEventSurveyQuestions } from '@/hooks/useSurveyBuilder';
import { useSurveyReport } from '@/hooks/useSurveyReport';
import {
  aggregateQuestion,
  answerToDisplay,
  questionKind,
  responseRate,
  toCsv,
  QUESTION_KIND_FILTERS,
  type QuestionAgg,
  type QuestionKindFilter,
} from '@/lib/surveyReport';
import { barWidthClass } from '@/lib/percentBar';
import { QUESTION_TYPE_LABEL, RATING_SCALE } from '@/lib/satisfaction';
import { formatDateTime } from '@/lib/datetime';
import type { SurveyAnswerRow, SurveyQuestion } from '@/types/satisfaction';
import type { AssignableUser, EventParticipantRow } from '@/types/eventDetail';

/** 가로 막대 + 수치(평점 분포·객관식 비율 공용). */
function StatBar({ label, count, pct }: { label: string; count: number; pct: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-24 shrink-0 truncate text-xs text-neutral-base/80">{label}</span>
      <div className="h-3 flex-1 overflow-hidden rounded-full bg-neutral-base/10">
        <div className={`h-full rounded-full bg-neutral-base/70 ${barWidthClass(pct)}`} />
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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-bold text-neutral-base">{q.title}</span>
        <Badge tone="muted" className="text-neutral-base/70">
          {QUESTION_TYPE_LABEL[q.question_type]}
        </Badge>
      </div>

      {agg.kind === 'RATING' && (
        <div className="flex flex-col gap-1.5">
          <p className="text-sm text-neutral-base/80">
            평균 <span className="font-bold text-neutral-base">{agg.average.toFixed(2)}</span> / 5 ·
            응답 {agg.count}명
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

/** 응답자(스타트업) 식별 컬럼(기업/소속, 성명). */
function respondentOrg(u: AssignableUser | undefined): string {
  if (!u) return '(알 수 없음)';
  return u.company_name ?? u.name;
}
function respondentName(u: AssignableUser | undefined): string {
  if (!u) return '';
  return u.representative_name ?? u.name;
}

/**
 * 만족도 조사 결과 리포트 패널 (관리자 행사 상세 — 행사 만족도 결과 탭).
 * 출처: docs/survey_customization_ideation.md §3.2, §5.
 * 행사 만족도는 스타트업만 응답한다(전문가 응답 기능은 제거됨).
 * 응답률 + 문항별 집계(평점 분포·객관식 비율·주관식 목록) + CSV 내보내기.
 */
export function SurveyReportPanel({
  eventId,
  participants,
  userById,
  timezone,
  onOpenSettings,
}: {
  eventId: string;
  participants: EventParticipantRow[];
  userById: Map<string, AssignableUser>;
  timezone: string;
  /** 제공 시 카드 헤더에 "행사 만족도 설정" 버튼을 노출(관리 권한일 때만 전달). */
  onOpenSettings?: () => void;
}) {
  const questionsQ = useEventSurveyQuestions(eventId);
  const reportQ = useSurveyReport(eventId);

  const questions = useMemo(
    () =>
      (questionsQ.data ?? [])
        .filter((q) => q.survey_scope === 'EVENT')
        .filter((q) => q.target_role === 'STARTUP' || q.target_role === 'ALL')
        .sort((a, b) => a.order_no - b.order_no),
    [questionsQ.data],
  );

  // 검색(응답 기업/대표자명) + 문항 유형 필터.
  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState<QuestionKindFilter>('ALL');
  const keyword = useDebouncedValue(search.trim().toLowerCase(), 200);

  // 현재 참가 중인 스타트업 user_id 집합 — 참가자 목록에서 제거된 스타트업의
  // 잔존 응답(분모에는 없는데 분자에는 잡혀 응답률 100% 초과)을 집계에서 제외한다.
  const startupParticipantIds = useMemo(
    () =>
      new Set(
        participants.filter((p) => p.participant_type === 'STARTUP').map((p) => p.user_id),
      ),
    [participants],
  );

  const responses = useMemo(
    () =>
      (reportQ.data ?? []).filter(
        (r) => r.user_role === 'STARTUP' && startupParticipantIds.has(r.user_id),
      ),
    [reportQ.data, startupParticipantIds],
  );

  // 검색어로 응답(스타트업)을 좁힌 집합 — 집계는 이 집합 기준으로 다시 계산된다.
  const filteredResponses = useMemo(() => {
    if (!keyword) return responses;
    return responses.filter((r) => {
      const u = userById.get(r.user_id);
      return `${respondentOrg(u)} ${respondentName(u)}`.toLowerCase().includes(keyword);
    });
  }, [responses, keyword, userById]);

  // 유형 필터로 노출할 문항만.
  const visibleQuestions = useMemo(
    () =>
      questions.filter((q) => kindFilter === 'ALL' || questionKind(q.question_type) === kindFilter),
    [questions, kindFilter],
  );

  // 문항별 답변 모음(검색으로 좁힌 응답 기준 집계).
  const answersByQuestion = useMemo(() => {
    const m = new Map<string, SurveyAnswerRow[]>();
    for (const r of filteredResponses) {
      for (const a of r.answers) {
        const arr = m.get(a.question_id) ?? [];
        arr.push(a);
        m.set(a.question_id, arr);
      }
    }
    return m;
  }, [filteredResponses]);

  const totalStartups = startupParticipantIds.size;
  const rate = responseRate(totalStartups, responses.length);

  const handleExport = () => {
    const headers = ['제출 시각', '기업/소속', '성명', ...questions.map((q) => q.title)];
    const rows = responses.map((r) => {
      const u = userById.get(r.user_id);
      const ansMap = new Map(r.answers.map((a) => [a.question_id, a]));
      return [
        formatDateTime(r.submitted_at, timezone),
        respondentOrg(u),
        respondentName(u),
        ...questions.map((q) => answerToDisplay(q, ansMap.get(q.id))),
      ];
    });
    const csv = toCsv(headers, rows);
    // 엑셀 한글 깨짐 방지를 위해 UTF-8 BOM 부착.
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '행사만족도결과.csv';
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
    <div className="flex flex-col gap-4">
      {/* 통계 카드 섹션 — 제목 + 응답 현황(예약/진행 관리와 동일한 StatBox 레이아웃) */}
      <Card className="flex flex-col gap-5 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-bold text-neutral-base">행사 만족도 결과</h2>
            <p className="text-sm text-neutral-base/70">
              스타트업이 제출한 행사 만족도 응답을 문항별로 집계합니다. CSV 로 내려받아 외부 보고에
              활용할 수 있습니다.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {onOpenSettings && (
              <Button variant="outline" onClick={onOpenSettings}>
                행사 만족도 설정
              </Button>
            )}
            <Button variant="outline" onClick={handleExport} disabled={responses.length === 0}>
              CSV 내보내기
            </Button>
          </div>
        </div>

        {(questionsQ.isError || reportQ.isError) && (
          <Alert tone="error">결과를 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.</Alert>
        )}

        {/* 응답 현황 */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatBox label="참가 스타트업" value={totalStartups} hint="개사" />
          <StatBox label="응답 스타트업" value={rate.responded} hint="개사" />
          <StatBox label="응답 대기" value={Math.max(0, rate.total - rate.responded)} hint="개사" />
          <StatBox
            label="응답률"
            value={`${rate.pct}%`}
            tone={rate.total > 0 && rate.responded === rate.total ? 'success' : 'default'}
          />
        </div>
      </Card>

      {/* 문항별 집계 — 응답이 없어도 문항 구성은 그대로 노출(빈 집계로 표시). */}
      <Card className="flex flex-col gap-4 p-5">
        {/* 검색(응답 기업) + 문항 유형 토글 */}
        <FilterBar>
          <SearchInput value={search} onChange={setSearch} placeholder="응답 기업·대표자명 검색" />
          <FilterChips<QuestionKindFilter>
            value={kindFilter}
            onChange={setKindFilter}
            ariaLabel="문항 유형 필터"
            options={QUESTION_KIND_FILTERS}
          />
        </FilterBar>

        {keyword && (
          <p className="text-xs text-neutral-base/60">
            검색 결과 {filteredResponses.length}건 응답 기준으로 집계했습니다.
          </p>
        )}

        {questions.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-sm text-neutral-base/60">
            행사 만족도 문항이 없습니다. 행사 만족도 설정에서 문항을 추가하세요.
          </p>
        ) : visibleQuestions.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-sm text-neutral-base/60">
            선택한 유형의 문항이 없습니다.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {visibleQuestions.map((q) => (
              <QuestionResult
                key={q.id}
                q={q}
                agg={aggregateQuestion(q, answersByQuestion.get(q.id) ?? [])}
              />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
