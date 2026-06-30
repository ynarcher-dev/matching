import { useMemo, useState } from 'react';
import { Card } from '@/components/common/Card';
import { Alert } from '@/components/common/Alert';
import { Badge } from '@/components/common/Badge';
import { DataTable, type DataTableColumn } from '@/components/common/DataTable';
import { PageToolbar } from '@/components/common/PageToolbar';
import { SearchInput } from '@/components/common/FilterBar';
import { Pagination } from '@/components/common/Pagination';
import { RowActionGroup } from '@/components/common/RowActionGroup';
import { CompanyPhotoUploadPanel } from '@/components/staff/CompanyPhotoUploadPanel';
import { useDataTable } from '@/hooks/useDataTable';
import { useEventCompanyPhotos } from '@/hooks/useCompanyPhotos';
import { buildCompanyStatuses, summarizePhotoStatus } from '@/lib/companyPhoto';
import type { SortValue } from '@/lib/dataTable';
import { formatDateTime } from '@/lib/datetime';
import type { AssignableUser, EventParticipantRow } from '@/types/eventDetail';
import type { CompanyPhotoStatus, PhotoCompany } from '@/types/companyPhoto';

/**
 * 관리자 행사 상세 "사진 현황" 탭 (docs/staff_company_photo_upload.md §6 / 9-D).
 * 기업별 등록 현황(개수·마지막 업로드)·누락 기업·전체 요약을 8-C 공통 DataTable 로 제공하고,
 * 기업을 펼치면(검수) 사진 검수(조회/삭제)와 보완 업로드까지 할 수 있다(관리자도 is_admin_or_staff).
 */
export function PhotoStatusPanel({
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
  const photosQ = useEventCompanyPhotos(eventId);
  const [openCompany, setOpenCompany] = useState<string | null>(null);

  const companies = useMemo<PhotoCompany[]>(
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

  const statuses = useMemo(
    () => buildCompanyStatuses(companies, photosQ.data ?? []),
    [companies, photosQ.data],
  );
  const summary = useMemo(() => summarizePhotoStatus(statuses), [statuses]);

  const sortValues = useMemo<Record<string, (s: CompanyPhotoStatus) => SortValue>>(
    () => ({
      company: (s) => s.companyName,
      count: (s) => s.photoCount,
      last: (s) => s.lastUploadedAt,
    }),
    [],
  );

  const table = useDataTable(statuses, {
    getSearchText: (s) => [s.companyName, s.contactName].filter(Boolean).join(' '),
    sortValues,
    initialSort: { key: 'company', direction: 'asc' },
  });

  const columns = useMemo<DataTableColumn<CompanyPhotoStatus>[]>(
    () => [
      {
        key: 'company',
        header: '기업명',
        sortable: true,
        cell: (s) => <span className="font-medium text-neutral-base">{s.companyName}</span>,
      },
      {
        key: 'contact',
        header: '담당자',
        cell: (s) => <span className="text-neutral-base/80">{s.contactName}</span>,
      },
      {
        key: 'count',
        header: '사진 수',
        sortable: true,
        cell: (s) =>
          s.photoCount > 0 ? (
            <span className="font-semibold text-success">{s.photoCount}</span>
          ) : (
            <Badge tone="warning">미등록</Badge>
          ),
      },
      {
        key: 'last',
        header: '마지막 업로드',
        sortable: true,
        cell: (s) => (
          <span className="text-neutral-base/80">
            {s.lastUploadedAt ? formatDateTime(s.lastUploadedAt, timezone) : '-'}
          </span>
        ),
      },
      {
        key: 'actions',
        header: '',
        align: 'right',
        cell: (s) => (
          <RowActionGroup
            actions={[
              {
                key: 'inspect',
                label: openCompany === s.userId ? '닫기' : '검수',
                tone: 'brand',
                onClick: () => setOpenCompany((cur) => (cur === s.userId ? null : s.userId)),
              },
            ]}
          />
        ),
      },
    ],
    [openCompany, timezone],
  );

  const openCompanyInfo = companies.find((c) => c.userId === openCompany) ?? null;
  const openPhotos = useMemo(
    () => (photosQ.data ?? []).filter((p) => p.company_user_id === openCompany),
    [photosQ.data, openCompany],
  );

  return (
    <div className="flex flex-col gap-5">
      {/* 요약 지표 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard label="전체 기업" value={summary.totalCompanies} />
        <SummaryCard label="사진 있음" value={summary.withPhotos} tone="ok" />
        <SummaryCard label="사진 없음" value={summary.withoutPhotos} tone="warn" />
        <SummaryCard label="총 사진" value={summary.totalPhotos} />
      </div>

      {photosQ.isError && (
        <Alert tone="error">사진 현황을 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.</Alert>
      )}

      <PageToolbar
        search={
          <SearchInput
            value={table.search}
            onChange={table.setSearch}
            placeholder="기업명 또는 담당자명"
          />
        }
      />

      <DataTable
        columns={columns}
        rows={table.rows}
        rowKey={(s) => s.userId}
        sort={table.sort}
        onSort={table.toggleSort}
        loading={photosQ.isLoading}
        emptyMessage={statuses.length === 0 ? '참가 기업이 없습니다.' : '검색 결과가 없습니다.'}
      />

      <Pagination
        page={table.page}
        totalPages={table.totalPages}
        pageSize={table.pageSize}
        total={table.totalFiltered}
        onPageChange={table.setPage}
      />

      {openCompanyInfo && (
        <Card className="p-4">
          <CompanyPhotoUploadPanel
            eventId={eventId}
            company={openCompanyInfo}
            photos={openPhotos}
          />
        </Card>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'ok' | 'warn';
}) {
  const valueClass =
    tone === 'ok' ? 'text-success' : tone === 'warn' ? 'text-warning' : 'text-neutral-base';
  return (
    <Card className="p-3">
      <p className="text-xs text-neutral-base/70">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${valueClass}`}>{value}</p>
    </Card>
  );
}
