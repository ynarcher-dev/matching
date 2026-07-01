import { useMemo, useState } from 'react';
import { Badge } from '@/components/common/Badge';
import { Card } from '@/components/common/Card';
import { Alert } from '@/components/common/Alert';
import { SectionActionButton } from '@/components/common/ActionButton';
import { Spinner } from '@/components/common/Spinner';
import { StatBox } from '@/components/common/StatBox';
import { StatCardSection } from '@/components/common/StatCardSection';
import { FilterBar, SearchInput, FilterChips } from '@/components/common/FilterBar';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useEventSurveyQuestions } from '@/hooks/useSurveyBuilder';
import { useExpertSurveyReport } from '@/hooks/useSurveyReport';
import {
  aggregateQuestion,
  answerToDisplay,
  questionKind,
  toCsv,
  QUESTION_KIND_FILTERS,
  type QuestionAgg,
  type QuestionKindFilter,
} from '@/lib/surveyReport';
import { barWidthClass } from '@/lib/percentBar';
import { QUESTION_TYPE_LABEL, RATING_SCALE } from '@/lib/satisfaction';
import { formatDateTime } from '@/lib/datetime';
import type { SurveyAnswerRow, SurveyQuestion } from '@/types/satisfaction';
import type { SatisfactionPolicy } from '@/types/event';
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

/** 문항 1개 집계 시각화(전문가 만족도). */
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
            응답 {agg.count}건
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
            응답 {agg.responders}건{agg.multiple && ' · 복수 선택'}
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

function expertLabel(u: AssignableUser | undefined): string {
  if (!u) return '(알 수 없음)';
  const org = u.expert_organization?.trim();
  return org ? `${u.name} · ${org}` : u.name;
}
function startupLabel(u: AssignableUser | undefined): string {
  if (!u) return '(알 수 없음)';
  return u.company_name ?? u.representative_name ?? u.name;
}

/**
 * 전문가 만족도 결과 리포트 패널 (관리자 행사 상세 — 전문가 만족도 탭, 8-G).
 * 상담 전문가별로 응답(슬롯 단위)을 묶어 문항별로 집계한다. 전문가 선택 시 해당 전문가 집계만,
 * "전체"는 모든 전문가 응답 합산. CSV 는 응답 1건 = 1행(전문가·스타트업 식별 포함).
 */
export function ExpertSurveyReportPanel({
  eventId,
  participants,
  userById,
  timezone,
  satisfactionPolicy,
  totalSessions,
  onOpenSettings,
}: {
  eventId: string;
  participants: EventParticipantRow[];
  userById: Map<string, AssignableUser>;
  timezone: string;
  satisfactionPolicy: SatisfactionPolicy;
  /** 총 진행 세션(취소 제외 예약 세션) 수 — 제출 응답률의 분모. */
  totalSessions: number;
  /** 제공 시 카드 헤더에 "전문가 만족도 설정" 버튼을 노출(관리 권한일 때만 전달). */
  onOpenSettings?: () => void;
}) {
  const questionsQ = useEventSurveyQuestions(eventId);
  const reportQ = useExpertSurveyReport(eventId);

  // 검색(전문가·응답 스타트업명) + 문항 유형 필터.
  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState<QuestionKindFilter>('ALL');
  const keyword = useDebouncedValue(search.trim().toLowerCase(), 200);

  const questions = useMemo(
    () =>
      (questionsQ.data ?? [])
        .filter((q) => q.survey_scope === 'EXPERT')
        .filter((q) => q.target_role === 'STARTUP' || q.target_role === 'ALL')
        .sort((a, b) => a.order_no - b.order_no),
    [questionsQ.data],
  );

  // 현재 참가 중인 전문가·스타트업 user_id 집합. 참가자 목록에서 제거된 전문가/스타트업의
  // 잔존 응답(분모인 진행 세션에는 없는데 분자에는 잡혀 응답률 100% 초과)을 집계에서 제외한다.
  const expertParticipantIds = useMemo(
    () =>
      new Set(participants.filter((p) => p.participant_type === 'EXPERT').map((p) => p.user_id)),
    [participants],
  );
  const startupParticipantIds = useMemo(
    () =>
      new Set(participants.filter((p) => p.participant_type === 'STARTUP').map((p) => p.user_id)),
    [participants],
  );

  const responses = useMemo(
    () =>
      (reportQ.data ?? []).filter(
        (r) => startupParticipantIds.has(r.user_id) && expertParticipantIds.has(r.target_expert_id),
      ),
    [reportQ.data, startupParticipantIds, expertParticipantIds],
  );

  // 검색어로 응답(전문가·스타트업명)을 좁힌 집합 — 집계는 이 집합 기준으로 다시 계산된다.
  // (전문가별 탭 대신 검색으로 특정 전문가를 좁혀 본다.)
  const filteredResponses = useMemo(() => {
    if (!keyword) return responses;
    return responses.filter((r) => {
      const expert = expertLabel(userById.get(r.target_expert_id));
      const startup = startupLabel(userById.get(r.user_id));
      return `${expert} ${startup}`.toLowerCase().includes(keyword);
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

  const handleExport = () => {
    const headers = ['제출 시각', '전문가', '응답 스타트업', ...questions.map((q) => q.title)];
    const rows = responses.map((r) => {
      const ansMap = new Map(r.answers.map((a) => [a.question_id, a]));
      return [
        formatDateTime(r.submitted_at, timezone),
        expertLabel(userById.get(r.target_expert_id)),
        startupLabel(userById.get(r.user_id)),
        ...questions.map((q) => answerToDisplay(q, ansMap.get(q.id))),
      ];
    });
    const csv = toCsv(headers, rows);
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '전문가만족도결과.csv';
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

  const policyHint =
    satisfactionPolicy === 'EVENT_ONLY' || satisfactionPolicy === 'NONE'
      ? '현재 만족도 수집 정책에서는 전문가별 만족도를 수집하지 않습니다. 행사 설정에서 정책을 "상담 전문가별" 또는 "둘 다"로 변경하세요.'
      : null;

  // 상단 통계는 검색과 무관하게 전체 응답 기준(전문가 탭/집계만 검색을 반영).
  const responseRatePct =
    totalSessions > 0 ? Math.round((responses.length / totalSessions) * 100) : 0;

  return (
    <div className="flex flex-col gap-4">
      {/* 통계 카드 섹션 — 제목 + 응답 현황(공통 StatCardSection 레이아웃) */}
      <StatCardSection
        title="전문가 만족도 결과"
        description="스타트업이 상담한 전문가/세션별로 제출한 만족도를 전문가별로 집계합니다."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {onOpenSettings && (
              <SectionActionButton onClick={onOpenSettings}>전문가 만족도 설정</SectionActionButton>
            )}
            <SectionActionButton onClick={handleExport} disabled={responses.length === 0}>
              CSV 내보내기
            </SectionActionButton>
          </div>
        }
      >
        {policyHint && <Alert tone="info">{policyHint}</Alert>}
        {(questionsQ.isError || reportQ.isError) && (
          <Alert tone="error">결과를 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.</Alert>
        )}

        {/* 응답 현황 — 참가 규모 / 진행 세션 대비 제출 응답 */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatBox label="전문가 수" value={expertParticipantIds.size} hint="명" />
          <StatBox label="참가 스타트업 수" value={startupParticipantIds.size} hint="개사" />
          <StatBox label="세션 진행 횟수" value={totalSessions} hint="건" />
          <StatBox label="응답완료" value={responses.length} hint="건" />
          <StatBox
            label="응답대기"
            value={Math.max(0, totalSessions - responses.length)}
            hint="건"
          />
          <StatBox label="응답률" value={`${responseRatePct}%`} />
        </div>
      </StatCardSection>

      {/* 전문가별 집계 */}
      <Card className="flex flex-col gap-4 p-5">
        {/* 검색(전문가·응답 스타트업) + 문항 유형 토글 */}
        <FilterBar>
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="전문가·응답 스타트업명 검색"
          />
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

        {/* 문항별 집계 — 응답이 없어도 문항 구성은 그대로 노출(빈 집계로 표시). */}
        {questions.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-sm text-neutral-base/60">
            전문가 만족도 문항이 없습니다. 전문가 만족도 설정에서 문항을 추가하세요.
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
