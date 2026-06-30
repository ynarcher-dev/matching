import { Fragment, useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/common/Badge';
import { Card } from '@/components/common/Card';
import { Alert } from '@/components/common/Alert';
import { Button } from '@/components/common/Button';
import { Spinner } from '@/components/common/Spinner';
import { Modal } from '@/components/common/Modal';
import { FilterBar, SearchInput, FilterChips } from '@/components/common/FilterBar';
import { Pagination } from '@/components/common/Pagination';
import { StatBox } from '@/components/common/StatBox';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useEventCounselingQuestions } from '@/hooks/useCounselingBuilder';
import { useCounselingReport, type ReportCounselingLog } from '@/hooks/useCounselingReport';
import { answerToDisplay, toCsv } from '@/lib/counselingReport';
import { formatDateTime, formatRange } from '@/lib/datetime';
import { applyFilters, clampPage, filterByKeyword, pageCount, paginate } from '@/lib/dataTable';
import type { CounselingQuestion } from '@/types/counselingLog';
import type { AssignableUser, EventParticipantRow } from '@/types/eventDetail';

/** 기업 단위 페이지네이션 크기(한 페이지에 기업 N개사). */
const COMPANY_PAGE_SIZE = 10;

/** 세션 상태 필터 값. */
type StatusFilter = 'ALL' | 'COMPLETED' | 'INCOMPLETE';

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
  onOpenSettings,
}: {
  eventId: string;
  eventTitle: string;
  participants: EventParticipantRow[];
  userById: Map<string, AssignableUser>;
  timezone: string;
  /** 제공 시 카드 헤더에 "상담일지 설정" 버튼을 노출(관리 권한일 때만 전달). */
  onOpenSettings?: () => void;
}) {
  const questionsQ = useEventCounselingQuestions(eventId);
  const reportQ = useCounselingReport(eventId);
  // 8-F: 목록 행 클릭 시 상담 내용 상세를 모달로 보여준다.
  const [selected, setSelected] = useState<ReportCounselingLog | null>(null);
  // 8-J: 세션 상태 + 후속 연계 필터.
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [followUpOnly, setFollowUpOnly] = useState(false);

  const questions = useMemo(
    () => (questionsQ.data ?? []).slice().sort((a, b) => a.order_no - b.order_no),
    [questionsQ.data],
  );
  const logs = useMemo(() => reportQ.data ?? [], [reportQ.data]);

  // 작성 현황 통계는 상단 카드와 하단 표가 어긋나지 않도록 검색·상태·후속 필터를 반영한
  // filteredLogs/groups 에서 계산한다(아래 groups 정의 직후).

  // 검색·필터는 세션 단위로 적용한다(8-J). 검색은 디바운스.
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebouncedValue(search, 200);

  const filterPreds = useMemo(() => {
    const preds: Array<(l: ReportCounselingLog) => boolean> = [];
    if (statusFilter === 'COMPLETED') preds.push((l) => l.session_status === 'COMPLETED');
    else if (statusFilter === 'INCOMPLETE') preds.push((l) => l.session_status !== 'COMPLETED');
    if (followUpOnly) preds.push((l) => l.follow_up_required);
    return preds;
  }, [statusFilter, followUpOnly]);

  const searchText = useMemo(
    () => (l: ReportCounselingLog) => {
      const expert = l.expert_id ? userById.get(l.expert_id) : undefined;
      const startup = l.startup_id ? userById.get(l.startup_id) : undefined;
      return [startupName(startup), expert?.name, expertOrg(expert)].filter(Boolean).join(' ');
    },
    [userById],
  );

  const filteredLogs = useMemo(
    () => applyFilters(filterByKeyword(logs, debouncedSearch, searchText), filterPreds),
    [logs, debouncedSearch, searchText, filterPreds],
  );

  // 기업(스타트업) 단위 그룹. 그룹 내 세션은 상담 시작 시각 오름차순,
  // 그룹 순서는 가장 이른 상담 시각 기준 내림차순(최근 상담 기업이 위로).
  const groups = useMemo(() => {
    const byStartup = new Map<string, ReportCounselingLog[]>();
    for (const l of filteredLogs) {
      const key = l.startup_id ?? '(미배정)';
      const arr = byStartup.get(key);
      if (arr) arr.push(l);
      else byStartup.set(key, [l]);
    }
    const list = Array.from(byStartup.entries()).map(([startupId, sessions]) => {
      const sorted = sessions.slice().sort((a, b) => a.start_time.localeCompare(b.start_time));
      const startup = startupId !== '(미배정)' ? userById.get(startupId) : undefined;
      return { startupId, company: startupName(startup), sessions: sorted };
    });
    list.sort((a, b) => b.sessions[0].start_time.localeCompare(a.sessions[0].start_time));
    return list;
  }, [filteredLogs, userById]);

  // 작성 현황 통계: 세션(건) + 기업(개사). 표·페이지네이션과 동일한 filteredLogs/groups 를
  // 출처로 삼아 상단 카드와 하단 목록의 개수가 항상 일치한다. 기업은 소속(필터된) 세션이
  // 모두 완료면 '완료'로 본다.
  const stats = useMemo(() => {
    const totalSessions = filteredLogs.length;
    const completedSessions = filteredLogs.filter((l) => l.session_status === 'COMPLETED').length;
    const totalCompanies = groups.length;
    const completedCompanies = groups.filter((g) =>
      g.sessions.every((s) => s.session_status === 'COMPLETED'),
    ).length;
    return { totalSessions, completedSessions, totalCompanies, completedCompanies };
  }, [filteredLogs, groups]);

  // 기업 단위 페이지네이션(한 페이지 = 기업 COMPANY_PAGE_SIZE 개사).
  const totalCompanies = groups.length;
  const totalPages = pageCount(totalCompanies, COMPANY_PAGE_SIZE);
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, statusFilter, followUpOnly]);
  const safePage = clampPage(page, totalCompanies, COMPANY_PAGE_SIZE);
  useEffect(() => {
    if (safePage !== page) setPage(safePage);
  }, [safePage, page]);
  const pageGroups = useMemo(
    () => paginate(groups, safePage, COMPANY_PAGE_SIZE),
    [groups, safePage],
  );

  // 상단이 가장 큰 번호가 되도록 기업에 역순 번호를 매긴다(참가자 DB 와 동일 컨벤션).
  const getCompanyNumber = (indexOnPage: number) =>
    totalCompanies - ((safePage - 1) * COMPANY_PAGE_SIZE + indexOnPage);

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
        l.session_status === 'COMPLETED' && l.submitted_at
          ? formatDateTime(l.submitted_at, timezone)
          : '',
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

  return (
    <div className="flex flex-col gap-4">
      {/* 통계 카드 섹션 — 제목 + 작성 현황(예약/진행 관리와 동일한 StatBox 레이아웃) */}
      <Card className="flex flex-col gap-5 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-bold text-neutral-base">상담일지 결과</h2>
            <p className="text-sm text-neutral-base/70">
              전문가가 작성한 상담일지를 집계합니다. CSV 로 내려받아 외부 보고에 활용할 수 있습니다.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {onOpenSettings && (
              <Button variant="outline" onClick={onOpenSettings}>
                상담일지 설정
              </Button>
            )}
            <Button variant="outline" onClick={handleExport} disabled={logs.length === 0}>
              CSV 내보내기
            </Button>
          </div>
        </div>

        {(questionsQ.isError || reportQ.isError) && (
          <Alert tone="error">결과를 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.</Alert>
        )}

        {/* 작성 현황: 기업(개사) + 세션(건) 완료 */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatBox
            label="작성 완료 기업"
            value={`${stats.completedCompanies} / ${stats.totalCompanies}`}
            hint="개사"
          />
          <StatBox
            label="작성 완료 세션"
            value={`${stats.completedSessions} / ${stats.totalSessions}`}
            hint="건"
          />
          <StatBox
            label="기업 작성률"
            value={`${stats.totalCompanies > 0 ? Math.round((stats.completedCompanies / stats.totalCompanies) * 100) : 0}%`}
            tone={
              stats.totalCompanies > 0 && stats.completedCompanies === stats.totalCompanies
                ? 'success'
                : 'default'
            }
          />
          <StatBox
            label="세션 작성률"
            value={`${stats.totalSessions > 0 ? Math.round((stats.completedSessions / stats.totalSessions) * 100) : 0}%`}
            tone={
              stats.totalSessions > 0 && stats.completedSessions === stats.totalSessions
                ? 'success'
                : 'default'
            }
          />
        </div>
      </Card>

      {/* 상담일지 목록 — 기업명 그룹 + 세션 하위행(8-J 검색·필터, 기업 단위 페이지네이션) */}
      <Card className="flex flex-col gap-4 p-5">
        <FilterBar>
          <SearchInput value={search} onChange={setSearch} placeholder="스타트업·전문가명 검색" />
          <FilterChips<StatusFilter>
            value={statusFilter}
            onChange={setStatusFilter}
            ariaLabel="세션 상태 필터"
            options={[
              { value: 'ALL', label: '전체' },
              { value: 'COMPLETED', label: '작성 완료' },
              { value: 'INCOMPLETE', label: '미작성' },
            ]}
          />
          <FilterChips<'ALL' | 'FOLLOW'>
            value={followUpOnly ? 'FOLLOW' : 'ALL'}
            onChange={(v) => setFollowUpOnly(v === 'FOLLOW')}
            ariaLabel="후속 연계 필터"
            options={[
              { value: 'ALL', label: '후속 전체' },
              { value: 'FOLLOW', label: '후속 연계만' },
            ]}
          />
        </FilterBar>

        <CounselingGroupTable
          groups={pageGroups}
          getCompanyNumber={getCompanyNumber}
          userById={userById}
          timezone={timezone}
          onSelect={setSelected}
          emptyMessage={
            logs.length === 0
              ? '진행 대상 세션이 없습니다.'
              : '검색·필터 조건에 맞는 세션이 없습니다.'
          }
        />

        <Pagination
          page={safePage}
          totalPages={totalPages}
          pageSize={COMPANY_PAGE_SIZE}
          total={totalCompanies}
          onPageChange={setPage}
        />
      </Card>

      <CounselingLogDetailModal
        log={selected}
        questions={questions}
        userById={userById}
        timezone={timezone}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}

/** 한 기업(스타트업)의 상담 세션 묶음(테이블 그룹 1개). */
interface CounselingGroup {
  startupId: string;
  company: string;
  sessions: ReportCounselingLog[];
}

/**
 * 기업명 그룹 헤더 + 세션 하위행 테이블. 공통 DataTable 의 시각(둥근 테두리·헤더 톤·hover)을
 * 그대로 따르되, 기업 단위 그룹 표현을 위해 직접 마크업한다. 세션 행 클릭 시 상세 모달.
 */
function CounselingGroupTable({
  groups,
  getCompanyNumber,
  userById,
  timezone,
  onSelect,
  emptyMessage,
}: {
  groups: CounselingGroup[];
  getCompanyNumber: (indexOnPage: number) => number;
  userById: Map<string, AssignableUser>;
  timezone: string;
  onSelect: (log: ReportCounselingLog) => void;
  emptyMessage: string;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface-raised">
      <table className="w-full min-w-[860px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-border bg-surface text-neutral-base/80">
            <th className="w-12 px-3 py-2.5 font-semibold">No.</th>
            <th className="px-3 py-2.5 font-semibold">기업명</th>
            <th className="px-3 py-2.5 font-semibold">전문가</th>
            <th className="whitespace-nowrap px-3 py-2.5 font-semibold">상담 일시</th>
            <th className="px-3 py-2.5 text-center font-semibold">세션 상태</th>
            <th className="px-3 py-2.5 font-semibold">제출일자</th>
            <th className="px-3 py-2.5 text-center font-semibold">후속 연계</th>
          </tr>
        </thead>
        <tbody>
          {groups.length === 0 ? (
            <tr>
              <td colSpan={7} className="px-3 py-10 text-center text-sm text-neutral-base/60">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            groups.map((group, groupIndex) => (
              <Fragment key={group.startupId}>
                {/* 기업 헤더행 */}
                <tr className="border-t border-border bg-surface">
                  <td className="px-3 py-2 align-middle tabular-nums text-neutral-base/50">
                    {getCompanyNumber(groupIndex)}
                  </td>
                  <td colSpan={6} className="px-3 py-2 align-middle">
                    <span className="font-bold text-neutral-base">{group.company}</span>
                    <span className="ml-2 text-xs font-medium text-neutral-base/50">
                      · {group.sessions.length}건
                    </span>
                  </td>
                </tr>
                {/* 세션 하위행 */}
                {group.sessions.map((s) => {
                  const expert = s.expert_id ? userById.get(s.expert_id) : undefined;
                  return (
                    <tr
                      key={s.id}
                      onClick={() => onSelect(s)}
                      className="cursor-pointer border-b border-border last:border-b-0 hover:bg-surface/60"
                    >
                      <td className="px-3 py-2.5" />
                      <td className="px-3 py-2.5" />
                      <td className="px-3 py-2.5 align-middle">
                        <span className="flex items-center gap-1.5 pl-3 text-neutral-base/80">
                          <span aria-hidden className="text-neutral-base/30">
                            └
                          </span>
                          <span>
                            {expert?.name ?? '-'}
                            {expertOrg(expert) && (
                              <span className="text-xs text-neutral-base/60">
                                {' '}
                                · {expertOrg(expert)}
                              </span>
                            )}
                          </span>
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 align-middle text-neutral-base/70">
                        {s.start_time ? formatDateTime(s.start_time, timezone) : '-'}
                      </td>
                      <td className="px-3 py-2.5 text-center align-middle">
                        <Badge tone={s.session_status === 'COMPLETED' ? 'success' : 'muted'}>
                          {SESSION_STATUS_LABEL[s.session_status] ?? s.session_status}
                        </Badge>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 align-middle">
                        {s.submitted_at ? (
                          <span className="text-neutral-base/70">
                            {formatDateTime(s.submitted_at, timezone)}
                          </span>
                        ) : (
                          <span className="text-neutral-base/50">미제출</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-center align-middle">
                        {s.follow_up_required ? (
                          <Badge tone="brand">필요</Badge>
                        ) : (
                          <span className="text-xs text-neutral-base/30">–</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </Fragment>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

/** 상담일지 1건 상세 모달 (8-F: 목록 행 클릭). 문항별 답변 + 후속 연계 정보. */
function CounselingLogDetailModal({
  log,
  questions,
  userById,
  timezone,
  onClose,
}: {
  log: ReportCounselingLog | null;
  questions: CounselingQuestion[];
  userById: Map<string, AssignableUser>;
  timezone: string;
  onClose: () => void;
}) {
  const expert = log?.expert_id ? userById.get(log.expert_id) : undefined;
  const startup = log?.startup_id ? userById.get(log.startup_id) : undefined;
  const ansMap = useMemo(() => new Map((log?.answers ?? []).map((a) => [a.question_id, a])), [log]);

  // 평점 문항(기술성~거래 가능성)은 사용하지 않으므로 서술·선택 문항만 본문에 노출한다.
  const otherQuestions = questions.filter((q) => q.question_type !== 'RATING');

  return (
    <Modal open={log != null} onClose={onClose} title="상담일지 상세">
      {log && (
        <div className="flex flex-col gap-5">
          {/* 메타 — 기업명 / 전문가·소속 / 상담일시(시작~종료) / 제출일자 */}
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-lg border border-border bg-surface px-4 py-3">
            <dt className="text-xs font-semibold text-neutral-base/55">기업명</dt>
            <dd className="text-sm font-bold text-neutral-base">{startupName(startup)}</dd>

            <dt className="text-xs font-semibold text-neutral-base/55">전문가 · 소속</dt>
            <dd className="text-sm text-neutral-base">
              {expert?.name ?? '-'}
              {expertOrg(expert) && (
                <span className="text-neutral-base/60"> · {expertOrg(expert)}</span>
              )}
            </dd>

            <dt className="text-xs font-semibold text-neutral-base/55">상담 일시</dt>
            <dd className="text-sm text-neutral-base">
              {log.start_time && log.end_time
                ? formatRange(log.start_time, log.end_time, timezone)
                : log.start_time
                  ? formatDateTime(log.start_time, timezone)
                  : '-'}
              <Badge
                tone={log.session_status === 'COMPLETED' ? 'success' : 'muted'}
                className="ml-2"
              >
                {SESSION_STATUS_LABEL[log.session_status] ?? log.session_status}
              </Badge>
            </dd>

            <dt className="text-xs font-semibold text-neutral-base/55">제출일자</dt>
            <dd className="text-sm text-neutral-base">
              {log.submitted_at ? formatDateTime(log.submitted_at, timezone) : '미제출'}
            </dd>
          </dl>

          {/* 서술·선택 문항 — 본문의 주. 라벨/카드 톤을 통일하고 넉넉한 간격으로 읽기 쉽게. */}
          {otherQuestions.length > 0 && (
            <div className="flex flex-col gap-4">
              {otherQuestions.map((q) => {
                const answer = ansMap.get(q.id);
                const isChoice =
                  q.question_type === 'SINGLE_CHOICE' || q.question_type === 'MULTIPLE_CHOICE';
                const selections = answer?.answer_selections ?? [];
                const text = answerToDisplay(q, answer);
                const hasAnswer = isChoice ? selections.length > 0 : !!text;
                return (
                  <div key={q.id} className="flex flex-col gap-1.5">
                    <span className="text-xs font-semibold text-neutral-base/55">{q.title}</span>
                    {!hasAnswer ? (
                      <span className="text-sm text-neutral-base/30">미응답</span>
                    ) : isChoice ? (
                      <div className="flex flex-wrap gap-1.5">
                        {selections.map((s) => (
                          <Badge key={s} tone="brand">
                            {s}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <p className="whitespace-pre-wrap rounded-lg border border-border bg-surface px-4 py-3 text-sm leading-relaxed text-neutral-base">
                        {text}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* 후속 연계 유무 + (필요 시) 코멘트 */}
          <div className="flex flex-col gap-2 border-t border-dashed border-border pt-3">
            <Badge tone={log.follow_up_required ? 'brand' : 'muted'} className="self-start">
              후속 연계 {log.follow_up_required ? '필요' : '없음'}
            </Badge>
            {log.follow_up_required && log.follow_up_memo && (
              <p className="whitespace-pre-wrap rounded-lg border border-border bg-surface px-4 py-3 text-sm leading-relaxed text-neutral-base">
                {log.follow_up_memo}
              </p>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
