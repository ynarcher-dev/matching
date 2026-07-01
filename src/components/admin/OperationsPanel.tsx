import { useMemo, useState } from 'react';
import { Alert } from '@/components/common/Alert';
import { Badge } from '@/components/common/Badge';
import { Card } from '@/components/common/Card';
import { Button } from '@/components/common/Button';
import { DataTable, type DataTableColumn } from '@/components/common/DataTable';
import { PageToolbar } from '@/components/common/PageToolbar';
import { SearchInput } from '@/components/common/FilterBar';
import { Toggle } from '@/components/common/Toggle';
import { Pagination } from '@/components/common/Pagination';
import { StatBox } from '@/components/common/StatBox';
import { useDataTable } from '@/hooks/useDataTable';
import { useCounselingReport } from '@/hooks/useCounselingReport';
import { useSurveyReport, useExpertSurveyReport } from '@/hooks/useSurveyReport';
import { useEventCompanyPhotos } from '@/hooks/useCompanyPhotos';
import { useArtifactBundle } from '@/hooks/useArtifactBundle';
import {
  buildDeliverableRows,
  isMetricMet,
  summarizeDeliverables,
  type DeliverableCompany,
  type DeliverableMetric,
  type DeliverableRow,
} from '@/lib/deliverables';
import type { BundleCompany } from '@/lib/artifactBundle';
import type { SortValue } from '@/lib/dataTable';
import type { SatisfactionPolicy } from '@/types/event';
import type { AssignableUser, EventParticipantRow } from '@/types/eventDetail';

/**
 * 관리자 행사 상세 "운영관리" 탭 (증빙사진 탭 대체, docs/counseling_management_ideation.md).
 * 기업 단위로 상담횟수·일지·행사/전문가 만족도·사진의 충족 현황과 최종 완료 여부를 8-C 공통
 * DataTable 로 집계한다. 사진 등록·검수는 진행관리 그리드 셀(📷)에서 하고, 여기서는 현황 집계 +
 * 체크박스로 기업을 골라(태그로 누적, 페이지 넘겨도 유지) 산출물(데이터+사진)을 ZIP 으로 일괄 다운로드한다
 * (docs/artifact_management_ideation.md).
 */
export function OperationsPanel({
  eventId,
  eventTitle,
  eventStart,
  timezone,
  participants,
  userById,
  satisfactionPolicy,
}: {
  eventId: string;
  eventTitle: string;
  /** 행사 시작 일시(ISO) — 산출물 사진 파일명의 {행사일자}에 사용. */
  eventStart: string;
  timezone: string;
  participants: EventParticipantRow[];
  userById: Map<string, AssignableUser>;
  satisfactionPolicy: SatisfactionPolicy;
}) {
  const logsQ = useCounselingReport(eventId);
  const eventSurveyQ = useSurveyReport(eventId);
  const expertSurveyQ = useExpertSurveyReport(eventId);
  const photosQ = useEventCompanyPhotos(eventId);
  const bundle = useArtifactBundle(eventId, eventTitle, timezone, eventStart);

  const [incompleteOnly, setIncompleteOnly] = useState(false);
  // 선택 기업 id 집합 — 표/페이지와 독립이라 페이지를 넘겨도 선택(태그)이 유지된다.
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const companies = useMemo<DeliverableCompany[]>(
    () =>
      participants
        .filter((p) => p.participant_type === 'STARTUP')
        .map((p) => {
          const u = userById.get(p.user_id);
          return {
            userId: p.user_id,
            companyName: u?.company_name || u?.name || '(이름 미상)',
            contactName: u?.representative_name || u?.name || '',
          };
        }),
    [participants, userById],
  );

  // 참가 스타트업/전문가 식별자 — 제거된 참가자의 고아 응답을 분모/응답에서 제외한다.
  const startupIds = useMemo(() => new Set(companies.map((c) => c.userId)), [companies]);
  const expertIds = useMemo(
    () =>
      new Set(
        participants.filter((p) => p.participant_type === 'EXPERT').map((p) => p.user_id),
      ),
    [participants],
  );

  const eventResponses = useMemo(
    () =>
      (eventSurveyQ.data ?? []).filter(
        (r) => r.user_role === 'STARTUP' && startupIds.has(r.user_id),
      ),
    [eventSurveyQ.data, startupIds],
  );
  const expertResponses = useMemo(
    () =>
      (expertSurveyQ.data ?? []).filter(
        (r) => startupIds.has(r.user_id) && expertIds.has(r.target_expert_id),
      ),
    [expertSurveyQ.data, startupIds, expertIds],
  );

  const photoCountByCompany = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of photosQ.data ?? []) {
      m.set(p.company_user_id, (m.get(p.company_user_id) ?? 0) + 1);
    }
    return m;
  }, [photosQ.data]);

  const rows = useMemo(
    () =>
      buildDeliverableRows({
        companies,
        logs: logsQ.data ?? [],
        eventResponses,
        expertResponses,
        photoCountByCompany,
        satisfactionPolicy,
      }),
    [companies, logsQ.data, eventResponses, expertResponses, photoCountByCompany, satisfactionPolicy],
  );

  const summary = useMemo(() => summarizeDeliverables(rows), [rows]);

  // 선택 토글(개별/페이지 일괄). 태그·다운로드 모두 이 집합을 대상으로 한다.
  const toggleOne = (userId: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  const setMany = (userIds: string[], on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of userIds) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  // 선택된 기업 정보(태그·다운로드 공용) — rows 전체에서 해석.
  const selectedCompanies = useMemo<BundleCompany[]>(
    () =>
      rows
        .filter((r) => selected.has(r.userId))
        .map((r) => ({ userId: r.userId, companyName: r.companyName, contactName: r.contactName })),
    [rows, selected],
  );

  const handleDownload = () => {
    if (selectedCompanies.length === 0) return;
    bundle.mutate({ companies: selectedCompanies, userById });
  };

  const sortValues = useMemo<Record<string, (r: DeliverableRow) => SortValue>>(
    () => ({
      company: (r) => r.companyName,
      sessions: (r) => r.sessions.done,
      logs: (r) => r.logs.done,
      photos: (r) => r.photoCount,
      complete: (r) => (r.complete ? 1 : 0),
    }),
    [],
  );

  const filters = useMemo(
    () => (incompleteOnly ? [(r: DeliverableRow) => !r.complete] : []),
    [incompleteOnly],
  );

  const table = useDataTable(rows, {
    getSearchText: (r) => [r.companyName, r.contactName].filter(Boolean).join(' '),
    sortValues,
    filters,
    initialSort: { key: 'company', direction: 'asc' },
  });

  // 현재 페이지의 행 id(페이지 일괄 선택용).
  const pageIds = table.rows.map((r) => r.userId);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));

  const columns = useMemo<DataTableColumn<DeliverableRow>[]>(
    () => [
      {
        key: 'select',
        header: (
          <input
            type="checkbox"
            className="h-4 w-4 accent-brand align-middle"
            checked={allPageSelected}
            onChange={(e) => setMany(pageIds, e.target.checked)}
            aria-label="이 페이지 전체 선택"
          />
        ),
        align: 'center',
        className: 'w-10',
        cell: (r) => (
          <input
            type="checkbox"
            className="h-4 w-4 accent-brand align-middle"
            checked={selected.has(r.userId)}
            onChange={() => toggleOne(r.userId)}
            aria-label={`${r.companyName} 선택`}
          />
        ),
      },
      {
        key: 'no',
        header: 'No.',
        className: 'w-12',
        cell: (_r, index) => (
          <span className="tabular-nums text-neutral-base/50">
            {(table.page - 1) * table.pageSize + index + 1}
          </span>
        ),
      },
      {
        key: 'company',
        header: '기업명',
        sortable: true,
        className: 'min-w-[160px]',
        cell: (r) => <span className="font-medium text-neutral-base">{r.companyName}</span>,
      },
      {
        key: 'sessions',
        header: '상담횟수',
        sortable: true,
        align: 'center',
        cell: (r) => <MetricCell metric={r.sessions} />,
      },
      {
        key: 'logs',
        header: '일지',
        sortable: true,
        align: 'center',
        cell: (r) => <MetricCell metric={r.logs} />,
      },
      {
        key: 'eventSurvey',
        header: '행사 만족도',
        align: 'center',
        cell: (r) => <MetricCell metric={r.eventSurvey} />,
      },
      {
        key: 'expertSurvey',
        header: '전문가 만족도',
        align: 'center',
        cell: (r) => <MetricCell metric={r.expertSurvey} />,
      },
      {
        key: 'photos',
        header: '사진제출',
        sortable: true,
        align: 'center',
        cell: (r) =>
          r.photoCount > 0 ? (
            <span className="font-semibold text-neutral-base tabular-nums">{r.photoCount}</span>
          ) : (
            <Badge tone="warning">미등록</Badge>
          ),
      },
      {
        key: 'complete',
        header: '최종 여부',
        sortable: true,
        align: 'center',
        cell: (r) =>
          r.complete ? <Badge tone="success">완료</Badge> : <Badge tone="muted">미완료</Badge>,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- toggleOne/setMany/pageIds 는 매 렌더 새로 만들어도 무방.
    [table.page, table.pageSize, table.rows, selected, allPageSelected],
  );

  const anyError =
    logsQ.isError || eventSurveyQ.isError || expertSurveyQ.isError || photosQ.isError;
  const anyLoading =
    logsQ.isLoading || eventSurveyQ.isLoading || expertSurveyQ.isLoading || photosQ.isLoading;

  return (
    <div className="flex flex-col gap-5">
      {/* 요약 지표 — 전문가 만족도 결과(8-G)와 동일한 카드 + StatBox 그리드 레이아웃. */}
      <Card className="flex flex-col gap-5 p-5">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-bold text-neutral-base">운영 현황</h2>
          <p className="text-sm text-neutral-base/70">
            기업별 산출물(상담·일지·만족도·사진) 충족 현황과 최종 완료 여부를 집계합니다.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatBox label="전체 기업" value={summary.total} hint="개사" />
          <StatBox label="완료" value={summary.complete} hint="개사" tone="success" />
          <StatBox label="미완료" value={summary.incomplete} hint="개사" tone="warning" />
        </div>
      </Card>

      {anyError && (
        <Alert tone="error">운영 현황을 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.</Alert>
      )}
      {bundle.isError && (
        <Alert tone="error">
          산출물 다운로드에 실패했습니다. {(bundle.error as Error)?.message ?? ''}
        </Alert>
      )}
      {bundle.isSuccess && (bundle.data?.photoFailures ?? 0) > 0 && (
        <Alert tone="info">
          다운로드는 완료했지만 사진 {bundle.data!.photoFailures}장을 가져오지 못했습니다.
        </Alert>
      )}

      <PageToolbar
        search={
          <SearchInput
            value={table.search}
            onChange={table.setSearch}
            placeholder="기업명 또는 담당자명"
          />
        }
        filters={
          <div className="flex items-center gap-2">
            <Toggle
              checked={incompleteOnly}
              onChange={setIncompleteOnly}
              label="미완료만 보기"
            />
            <button
              type="button"
              onClick={() => setIncompleteOnly((v) => !v)}
              className="text-sm text-neutral-base/80"
            >
              미완료만 보기
            </button>
          </div>
        }
        actions={
          <Button onClick={handleDownload} disabled={selected.size === 0 || bundle.isPending}>
            {bundle.isPending ? 'ZIP 생성 중…' : `산출물 일괄 다운로드 (${selected.size})`}
          </Button>
        }
      />

      {/* 선택 태그 — 페이지와 무관하게 누적된 선택 기업. ✕ 또는 전체 해제로 취소. */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-border bg-surface px-3 py-2.5">
          <span className="text-xs font-semibold text-neutral-base/60">선택 {selected.size}개사</span>
          {selectedCompanies.map((c) => (
            <span
              key={c.userId}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-white px-2 py-0.5 text-xs text-neutral-base"
            >
              {c.companyName}
              <button
                type="button"
                onClick={() => toggleOne(c.userId)}
                className="text-neutral-base/40 hover:text-brand"
                aria-label={`${c.companyName} 선택 해제`}
              >
                ✕
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="ml-1 text-xs font-medium text-neutral-base/60 hover:text-brand"
          >
            전체 해제
          </button>
        </div>
      )}

      {/* 다른 관리 표(참가자 DB·알림 로그)와 동일하게 전체폭 표 + 바로 아래 페이지네이션. */}
      <DataTable
        columns={columns}
        rows={table.rows}
        rowKey={(r) => r.userId}
        sort={table.sort}
        onSort={table.toggleSort}
        loading={anyLoading}
        minWidthClass="min-w-[720px]"
        emptyMessage={rows.length === 0 ? '참가 기업이 없습니다.' : '검색 결과가 없습니다.'}
      />
      <Pagination
        page={table.page}
        totalPages={table.totalPages}
        pageSize={table.pageSize}
        total={table.totalFiltered}
        onPageChange={table.setPage}
      />
    </div>
  );
}

/** n/n 셀. 미수집(null)은 '–', 충족 시 success, 미충족은 중립색. */
function MetricCell({ metric }: { metric: DeliverableMetric | null }) {
  if (metric === null) {
    return <span className="text-neutral-base/30">–</span>;
  }
  const met = isMetricMet(metric);
  return (
    <span className={`tabular-nums font-semibold ${met ? 'text-success' : 'text-neutral-base/70'}`}>
      {metric.done} / {metric.total}
    </span>
  );
}
