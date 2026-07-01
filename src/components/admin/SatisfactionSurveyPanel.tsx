import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/common/Badge';
import { Card } from '@/components/common/Card';
import { Alert } from '@/components/common/Alert';
import { SectionActionButton } from '@/components/common/ActionButton';
import { Spinner } from '@/components/common/Spinner';
import { StatBox } from '@/components/common/StatBox';
import { StatCardSection } from '@/components/common/StatCardSection';
import { FilterBar, SearchInput } from '@/components/common/FilterBar';
import { Pagination } from '@/components/common/Pagination';
import { DEFAULT_PAGE_SIZE, pageCount, paginate } from '@/lib/dataTable';
import { Tabs } from '@/components/common/Tabs';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useEventSurveyQuestions } from '@/hooks/useSurveyBuilder';
import { useSurveyReport, useExpertSurveyReport } from '@/hooks/useSurveyReport';
import {
  aggregateQuestion,
  answerToDisplay,
  responseRate,
  toCsv,
} from '@/lib/surveyReport';
import { barWidthClass } from '@/lib/percentBar';
import { QUESTION_TYPE_LABEL, RATING_SCALE } from '@/lib/satisfaction';
import { formatDateTime } from '@/lib/datetime';
import type { SurveyAnswerRow, SurveyQuestion } from '@/types/satisfaction';
import type { SatisfactionPolicy } from '@/types/event';
import type { AssignableUser, EventParticipantRow, MatchingSlotRow } from '@/types/eventDetail';

/** 가로 막대 + 수치(평점 분포·객관식 비율 공용). */
function StatBar({ label, count, pct }: { label: string; count: number; pct: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-24 shrink-0 truncate text-xs text-neutral-base/85">{label}</span>
      <div className="h-3 flex-1 overflow-hidden rounded-full bg-neutral-base/10">
        <div className={`h-full rounded-full bg-neutral-base/75 ${barWidthClass(pct)}`} />
      </div>
      <span className="w-16 shrink-0 text-right text-xs text-neutral-base/75">
        {count}명 ({pct}%)
      </span>
    </div>
  );
}

/** 문항 1개 집계 시각화. */
function QuestionResult({ q, agg }: { q: SurveyQuestion; agg: ReturnType<typeof aggregateQuestion> }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-4 bg-surface/50">
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
            <div className="flex flex-col gap-2 max-h-60 overflow-y-auto pr-1">
              {agg.answers.map((t, i) => (
                <p
                  key={i}
                  className="whitespace-pre-wrap rounded-lg border border-border bg-surface px-3 py-2 text-sm text-neutral-base/90"
                >
                  {t}
                </p>
              ))}
            </div>
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

function IndividualAnswerDisplay({ q, answer }: { q: SurveyQuestion; answer: SurveyAnswerRow | undefined }) {
  if (!answer) {
    return <span className="text-neutral-base/40 italic">응답 없음</span>;
  }

  if (q.question_type === 'RATING' && answer.answer_rating != null) {
    return (
      <div className="flex items-center gap-1 mt-1">
        <span className="text-amber-500 text-sm">★</span>
        <span className="text-sm font-bold text-neutral-base">{answer.answer_rating}</span>
        <span className="text-xs text-neutral-base/50">/ 5점</span>
      </div>
    );
  }

  if ((q.question_type === 'SINGLE_CHOICE' || q.question_type === 'MULTIPLE_CHOICE') && answer.answer_selections) {
    return (
      <div className="flex flex-wrap gap-1 mt-1">
        {answer.answer_selections.map((sel) => (
          <span
            key={sel}
            className="inline-flex items-center rounded bg-brand/5 border border-brand/20 px-2 py-0.5 text-xs font-semibold text-brand"
          >
            {sel}
          </span>
        ))}
      </div>
    );
  }

  return (
    <p className="mt-1 text-sm text-neutral-base/90 bg-surface border border-border rounded-lg px-3 py-2 whitespace-pre-wrap font-medium">
      {answer.answer_text || ''}
    </p>
  );
}

type SurveySubTab = 'event' | 'expert' | 'status';

const SUB_TABS = [
  { value: 'event', label: '행사 만족도' },
  { value: 'expert', label: '전문가 만족도' },
  { value: 'status', label: '응답 현황' },
] as const;

interface SatisfactionSurveyPanelProps {
  eventId: string;
  participants: EventParticipantRow[];
  userById: Map<string, AssignableUser>;
  timezone: string;
  satisfactionPolicy: SatisfactionPolicy;
  totalSessions: number;
  onOpenSettings?: () => void;
  onOpenExpertSettings?: () => void;
  slots: MatchingSlotRow[];
}

export function SatisfactionSurveyPanel({
  eventId,
  participants,
  userById,
  timezone,
  satisfactionPolicy,
  totalSessions,
  onOpenSettings,
  onOpenExpertSettings,
  slots,
}: SatisfactionSurveyPanelProps) {
  const [subTab, setSubTab] = useState<SurveySubTab>('event');
  const questionsQ = useEventSurveyQuestions(eventId);
  const reportQ = useSurveyReport(eventId);
  const expertReportQ = useExpertSurveyReport(eventId);

  // 검색어 (응답 현황 탭 전용)
  const [statusSearch, setStatusSearch] = useState('');
  const statusKeyword = useDebouncedValue(statusSearch.trim().toLowerCase(), 200);

  // 펼쳐진 스타트업 ID 목록
  const [expandedStartups, setExpandedStartups] = useState<Set<string>>(new Set());

  const toggleExpand = (startupId: string) => {
    setExpandedStartups((prev) => {
      const next = new Set(prev);
      if (next.has(startupId)) {
        next.delete(startupId);
      } else {
        next.add(startupId);
      }
      return next;
    });
  };

  // 문항 구분
  const eventQuestions = useMemo(
    () =>
      (questionsQ.data ?? [])
        .filter((q) => q.survey_scope === 'EVENT')
        .filter((q) => q.target_role === 'STARTUP' || q.target_role === 'ALL')
        .sort((a, b) => a.order_no - b.order_no),
    [questionsQ.data],
  );

  const expertQuestions = useMemo(
    () =>
      (questionsQ.data ?? [])
        .filter((q) => q.survey_scope === 'EXPERT')
        .filter((q) => q.target_role === 'STARTUP' || q.target_role === 'ALL')
        .sort((a, b) => a.order_no - b.order_no),
    [questionsQ.data],
  );

  // 참가자 필터링
  const startupParticipantIds = useMemo(
    () => new Set(participants.filter((p) => p.participant_type === 'STARTUP').map((p) => p.user_id)),
    [participants],
  );

  const expertParticipantIds = useMemo(
    () => new Set(participants.filter((p) => p.participant_type === 'EXPERT').map((p) => p.user_id)),
    [participants],
  );

  // 행사 만족도 응답 정제
  const eventResponses = useMemo(
    () =>
      (reportQ.data ?? []).filter(
        (r) => r.user_role === 'STARTUP' && startupParticipantIds.has(r.user_id),
      ),
    [reportQ.data, startupParticipantIds],
  );

  // 전문가 만족도 응답 정제
  const expertResponses = useMemo(
    () =>
      (expertReportQ.data ?? []).filter(
        (r) => startupParticipantIds.has(r.user_id) && expertParticipantIds.has(r.target_expert_id),
      ),
    [expertReportQ.data, startupParticipantIds, expertParticipantIds],
  );

  // CSV 내보내기 (행사 만족도)
  const handleExportEvent = () => {
    const headers = ['제출 시각', '기업/소속', '성명', ...eventQuestions.map((q) => q.title)];
    const rows = eventResponses.map((r) => {
      const u = userById.get(r.user_id);
      const ansMap = new Map(r.answers.map((a) => [a.question_id, a]));
      return [
        formatDateTime(r.submitted_at, timezone),
        startupLabel(u),
        u?.representative_name ?? u?.name ?? '',
        ...eventQuestions.map((q) => answerToDisplay(q, ansMap.get(q.id))),
      ];
    });
    const csv = toCsv(headers, rows);
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '행사만족도결과.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  // CSV 내보내기 (전문가 만족도)
  const handleExportExpert = () => {
    const headers = ['제출 시각', '전문가', '응답 스타트업', ...expertQuestions.map((q) => q.title)];
    const rows = expertResponses.map((r) => {
      const ansMap = new Map(r.answers.map((a) => [a.question_id, a]));
      return [
        formatDateTime(r.submitted_at, timezone),
        expertLabel(userById.get(r.target_expert_id)),
        startupLabel(userById.get(r.user_id)),
        ...expertQuestions.map((q) => answerToDisplay(q, ansMap.get(q.id))),
      ];
    });
    const csv = toCsv(headers, rows);
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '전문가만족도결과.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  // 응답 현황용 스타트업 목록 및 응답 정보 매핑
  const startupsList = useMemo(() => {
    const startups = participants
      .filter((p) => p.participant_type === 'STARTUP')
      .map((p) => userById.get(p.user_id))
      .filter((u): u is AssignableUser => Boolean(u));

    // 검색어 필터링
    return startups.filter((s) => {
      if (!statusKeyword) return true;
      const matchText = `${startupLabel(s)} ${s.representative_name ?? ''} ${s.name ?? ''}`.toLowerCase();
      return matchText.includes(statusKeyword);
    });
  }, [participants, userById, statusKeyword]);

  // 응답 현황 페이지네이션(다른 백오피스 테이블과 동일 규칙: 기본 30개/페이지).
  const [statusPage, setStatusPage] = useState(1);
  useEffect(() => setStatusPage(1), [statusKeyword]);
  const statusTotalPages = pageCount(startupsList.length, DEFAULT_PAGE_SIZE);
  const pagedStartups = paginate(startupsList, statusPage, DEFAULT_PAGE_SIZE);

  if (questionsQ.isLoading || reportQ.isLoading || expertReportQ.isLoading) {
    return (
      <Card className="flex items-center justify-center p-8">
        <Spinner className="h-5 w-5" />
      </Card>
    );
  }

  // 통계 계산
  const totalStartups = startupParticipantIds.size;
  const eventRate = responseRate(totalStartups, eventResponses.length);
  const expertRatePct = totalSessions > 0 ? Math.round((expertResponses.length / totalSessions) * 100) : 0;

  const expertPolicyHint =
    satisfactionPolicy === 'EVENT_ONLY' || satisfactionPolicy === 'NONE'
      ? '현재 만족도 수집 정책에서는 전문가별 만족도를 수집하지 않습니다. 행사 설정에서 정책을 "상담 전문가별" 또는 "둘 다"로 변경하세요.'
      : null;

  return (
    <div className="flex flex-col gap-4">
      {/* 서브 탭 */}
      <Tabs<SurveySubTab>
        value={subTab}
        options={SUB_TABS}
        onChange={setSubTab}
        ariaLabel="만족도 조사 상세 서브 탭"
      />

      {/* 1. 행사 만족도 결과 탭 */}
      {subTab === 'event' && (
        <div className="flex flex-col gap-4">
          <StatCardSection
            title="행사 만족도 결과"
            description="스타트업이 제출한 행사 만족도 응답을 문항별로 집계합니다. CSV 로 내려받아 외부 보고에 활용할 수 있습니다."
            actions={
              <div className="flex flex-wrap items-center gap-2">
                {onOpenSettings && (
                  <SectionActionButton onClick={onOpenSettings}>행사 만족도 설정</SectionActionButton>
                )}
                <SectionActionButton onClick={handleExportEvent} disabled={eventResponses.length === 0}>
                  CSV 내보내기
                </SectionActionButton>
              </div>
            }
          >
            {(questionsQ.isError || reportQ.isError) && (
              <Alert tone="error">결과를 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.</Alert>
            )}

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatBox label="참가 스타트업" value={totalStartups} hint="개사" />
              <StatBox label="응답 완료" value={eventRate.responded} hint="개사" />
              <StatBox label="응답 대기" value={Math.max(0, eventRate.total - eventRate.responded)} hint="개사" />
              <StatBox label="응답률" value={`${eventRate.pct}%`} />
            </div>
          </StatCardSection>

          <Card className="flex flex-col gap-4 p-5">
            {eventQuestions.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-sm text-neutral-base/60">
                행사 만족도 문항이 없습니다. 행사 만족도 설정에서 문항을 추가하세요.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {eventQuestions.map((q) => {
                  const qAnswers = eventResponses.flatMap(r => r.answers.filter(a => a.question_id === q.id));
                  return (
                    <QuestionResult
                      key={q.id}
                      q={q}
                      agg={aggregateQuestion(q, qAnswers)}
                    />
                  );
                })}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* 2. 전문가 만족도 결과 탭 */}
      {subTab === 'expert' && (
        <div className="flex flex-col gap-4">
          <StatCardSection
            title="전문가 만족도 결과"
            description="스타트업이 상담한 전문가/세션별로 제출한 만족도를 전문가별로 집계합니다."
            actions={
              <div className="flex flex-wrap items-center gap-2">
                {onOpenExpertSettings && (
                  <SectionActionButton onClick={onOpenExpertSettings}>전문가 만족도 설정</SectionActionButton>
                )}
                <SectionActionButton onClick={handleExportExpert} disabled={expertResponses.length === 0}>
                  CSV 내보내기
                </SectionActionButton>
              </div>
            }
          >
            {expertPolicyHint && <Alert tone="info">{expertPolicyHint}</Alert>}
            {(questionsQ.isError || expertReportQ.isError) && (
              <Alert tone="error">결과를 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.</Alert>
            )}

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <StatBox label="전문가 수" value={expertParticipantIds.size} hint="명" />
              <StatBox label="참가 스타트업 수" value={startupParticipantIds.size} hint="개사" />
              <StatBox label="세션 진행 횟수" value={totalSessions} hint="건" />
              <StatBox label="응답완료" value={expertResponses.length} hint="건" />
              <StatBox
                label="응답대기"
                value={Math.max(0, totalSessions - expertResponses.length)}
                hint="건"
              />
              <StatBox label="응답률" value={`${expertRatePct}%`} />
            </div>
          </StatCardSection>

          <Card className="flex flex-col gap-4 p-5">
            {expertQuestions.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-sm text-neutral-base/60">
                전문가 만족도 문항이 없습니다. 전문가 만족도 설정에서 문항을 추가하세요.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {expertQuestions.map((q) => {
                  const qAnswers = expertResponses.flatMap(r => r.answers.filter(a => a.question_id === q.id));
                  return (
                    <QuestionResult
                      key={q.id}
                      q={q}
                      agg={aggregateQuestion(q, qAnswers)}
                    />
                  );
                })}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* 3. 응답 현황 탭 */}
      {subTab === 'status' && (
        <StatCardSection
          title="스타트업별 만족도 응답 현황"
          description="기업별로 행사 만족도 및 상담 매칭된 전문가 만족도 설문의 제출 여부를 확인하고 상세 응답 내용을 펼쳐볼 수 있습니다."
        >

          <FilterBar>
            <SearchInput
              value={statusSearch}
              onChange={setStatusSearch}
              placeholder="기업명·대표자명 검색"
            />
          </FilterBar>

          <div className="overflow-x-auto rounded-xl border border-border bg-surface-raised">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-border bg-surface text-neutral-base/80">
                  <th className="px-3 py-2.5 font-semibold">기업명 (대표자)</th>
                  <th className="px-3 py-2.5 text-center font-semibold">행사 만족도</th>
                  <th className="px-3 py-2.5 text-center font-semibold">전문가 만족도</th>
                  <th className="px-3 py-2.5 text-right font-semibold">상세</th>
                </tr>
              </thead>
              <tbody>
                {startupsList.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-10 text-center text-sm text-neutral-base/60">
                      참가 스타트업이 없거나 검색 결과가 존재하지 않습니다.
                    </td>
                  </tr>
                ) : (
                  pagedStartups.map((startup) => {
                    const hasSubmittedEvent = eventResponses.some(r => r.user_id === startup.id);
                    const startupExpertResponses = expertResponses.filter(r => r.user_id === startup.id);
                    // 해당 스타트업의 매칭 슬롯 중 전문가 만족도 대상 슬롯 개수 계산 (취소되지 않은 슬롯)
                    const startupSlots = slots.filter(
                      s => s.startup_id === startup.id && s.session_status !== 'CANCELLED'
                    );
                    const totalSlotsCount = startupSlots.length;
                    const completedCount = startupExpertResponses.length;

                    let expertBadgeTone: 'muted' | 'brand' | 'warning' = 'muted';
                    let expertBadgeText = '미제출';

                    if (totalSlotsCount === 0) {
                      expertBadgeTone = 'muted';
                      expertBadgeText = '대상 없음';
                    } else if (completedCount === 0) {
                      expertBadgeTone = 'muted';
                      expertBadgeText = '미제출';
                    } else if (completedCount < totalSlotsCount) {
                      expertBadgeTone = 'warning';
                      expertBadgeText = `${completedCount}/${totalSlotsCount} 완료`;
                    } else {
                      expertBadgeTone = 'brand';
                      expertBadgeText = '완료';
                    }
                    
                    const isExpanded = expandedStartups.has(startup.id);

                    return (
                      <>
                        <tr key={startup.id} className="border-b border-border hover:bg-surface/60">
                          <td className="px-3 py-2.5 align-middle">
                            <span className="font-bold text-neutral-base">{startupLabel(startup)}</span>
                            {startup.representative_name && (
                              <span className="text-xs text-neutral-base/60 ml-1.5">
                                ({startup.representative_name})
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-center align-middle">
                            {hasSubmittedEvent ? (
                              <Badge tone="brand">완료</Badge>
                            ) : (
                              <Badge tone="muted">미제출</Badge>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-center align-middle">
                            <Badge tone={expertBadgeTone}>{expertBadgeText}</Badge>
                          </td>
                          <td className="px-3 py-2.5 text-right align-middle">
                            <button
                              type="button"
                              onClick={() => toggleExpand(startup.id)}
                              className="text-xs font-semibold text-brand hover:underline px-2.5 py-1.5 rounded border border-border hover:bg-surface"
                            >
                              {isExpanded ? '닫기' : '펼쳐보기'}
                            </button>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr className="bg-neutral-base/[0.02]">
                            <td colSpan={4} className="px-6 py-4 border-b border-border">
                              <div className="flex flex-col gap-4">
                                {/* 행사 만족도 상세 */}
                                <div className="rounded-lg border border-border bg-surface p-5 flex flex-col gap-4 shadow-sm">
                                  <h4 className="text-sm font-bold text-neutral-base border-b border-border pb-2 flex justify-between items-center">
                                    <span className="flex items-center gap-1.5">
                                      <span className="h-3 w-1 rounded-full bg-brand" />
                                      행사 만족도 응답 내용
                                    </span>
                                    {hasSubmittedEvent && (
                                      <span className="text-xs font-normal text-neutral-base/50">
                                        제출: {formatDateTime(eventResponses.find(r => r.user_id === startup.id)!.submitted_at, timezone)}
                                      </span>
                                    )}
                                  </h4>
                                  {!hasSubmittedEvent ? (
                                    <p className="text-xs text-neutral-base/50 py-2">제출된 응답이 없습니다.</p>
                                  ) : (
                                    <div className="flex flex-col gap-4">
                                      {eventQuestions.map((q) => {
                                        const response = eventResponses.find(r => r.user_id === startup.id);
                                        const answer = response?.answers.find(a => a.question_id === q.id);
                                        return (
                                          <div key={q.id} className="text-xs">
                                            <p className="text-xs font-semibold text-neutral-base/70 mb-1">Q. {q.title}</p>
                                            <IndividualAnswerDisplay q={q} answer={answer} />
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>

                                {/* 전문가 만족도 상세 */}
                                <div className="rounded-lg border border-border bg-surface p-5 flex flex-col gap-4 shadow-sm">
                                  <h4 className="text-sm font-bold text-neutral-base border-b border-border pb-2">
                                    <span className="flex items-center gap-1.5">
                                      <span className="h-3 w-1 rounded-full bg-brand" />
                                      전문가 만족도 응답 내용
                                    </span>
                                  </h4>
                                  {startupExpertResponses.length === 0 ? (
                                    <p className="text-xs text-neutral-base/50 py-2">제출된 전문가 만족도 응답이 없습니다.</p>
                                  ) : (
                                    <div className="flex flex-col gap-4">
                                      {startupExpertResponses.map((r) => {
                                        const expertUser = userById.get(r.target_expert_id);
                                        const ansMap = new Map(r.answers.map((a) => [a.question_id, a]));
                                        return (
                                          <div key={r.id} className="border border-border/60 rounded-lg p-4 bg-surface shadow-sm">
                                            <div className="flex justify-between items-center mb-3 pb-2 border-b border-border/60">
                                              <span className="font-bold text-xs text-brand">
                                                대상 전문가: {expertLabel(expertUser)}
                                              </span>
                                              <span className="text-[10px] text-neutral-base/50">
                                                제출: {formatDateTime(r.submitted_at, timezone)}
                                              </span>
                                            </div>
                                            <div className="flex flex-col gap-3">
                                              {expertQuestions.map((q) => {
                                                const answer = ansMap.get(q.id);
                                                return (
                                                  <div key={q.id} className="text-xs">
                                                    <p className="font-semibold text-neutral-base/70 mb-1">Q. {q.title}</p>
                                                    <p className="pl-3 py-1.5 border-l-2 border-neutral-base/30 bg-neutral-base/5 rounded-r text-neutral-base whitespace-pre-wrap">
                                                      {answerToDisplay(q, answer) || <span className="text-neutral-base/40 italic">응답 없음</span>}
                                                    </p>
                                                  </div>
                                                );
                                              })}
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <Pagination
            page={statusPage}
            totalPages={statusTotalPages}
            pageSize={DEFAULT_PAGE_SIZE}
            total={startupsList.length}
            onPageChange={setStatusPage}
          />
        </StatCardSection>
      )}
    </div>
  );
}
