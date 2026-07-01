import { DataTable } from '@/components/common/DataTable';
import { SessionStatusBadge } from '@/components/expert/SessionStatusBadge';
import { formatDateTime } from '@/lib/datetime';
import type { DataTableColumn } from '@/components/common/DataTable';
import type { MatchingSlotRow } from '@/types/eventDetail';
import type { SlotStartup } from '@/types/expert';

export function ExpertScheduleTable({
  slots,
  startupById,
  tableCodeById,
  activeSlotId,
  timezone,
  onOpen,
}: {
  slots: MatchingSlotRow[];
  startupById: Map<string, SlotStartup>;
  tableCodeById: Map<string, string>;
  activeSlotId: string | null;
  timezone: string;
  onOpen?: (slot: MatchingSlotRow) => void;
}) {
  const hm = (iso: string) => formatDateTime(iso, timezone).slice(-5);
  const startupOf = (slot: MatchingSlotRow) =>
    slot.startup_id ? startupById.get(slot.startup_id) : undefined;

  const columns: DataTableColumn<MatchingSlotRow>[] = [
    {
      key: 'table',
      header: '매칭 테이블',
      align: 'center',
      className: 'whitespace-nowrap',
      cell: (s) => {
        const code = tableCodeById.get(s.table_id ?? '');
        return code ? (
          <span className="inline-block rounded bg-neutral-base px-2 py-0.5 text-xs font-bold text-white">
            {code}
          </span>
        ) : (
          <span className="text-neutral-base/30">-</span>
        );
      },
    },
    {
      key: 'time',
      header: '시간',
      className: 'whitespace-nowrap',
      cell: (s) => (
        <span className="font-mono text-sm font-semibold text-neutral-base">
          {hm(s.start_time)}
          <span className="text-neutral-base/40"> ~ {hm(s.end_time)}</span>
        </span>
      ),
    },
    {
      key: 'company',
      header: '기업명',
      cell: (s) => {
        if (!s.startup_id) return <span className="text-sm text-neutral-base/40">예약 없음</span>;
        const startup = startupOf(s);
        return (
          <span className="text-sm font-semibold text-neutral-base">
            {startup?.companyName ?? startup?.name ?? '(스타트업)'}
          </span>
        );
      },
    },
    {
      key: 'representative',
      header: '대표명',
      cell: (s) => {
        const representativeName = startupOf(s)?.representativeName;
        return representativeName ? (
          <span className="text-sm text-neutral-base">{representativeName}</span>
        ) : (
          <span className="text-neutral-base/30">-</span>
        );
      },
    },
    {
      key: 'proposal',
      header: 'IR/소개서 첨부',
      align: 'center',
      className: 'whitespace-nowrap',
      cell: (s) => <Yn value={Boolean(startupOf(s)?.proposalFileUrl)} />,
    },
    {
      key: 'url',
      header: 'URL 첨부',
      align: 'center',
      className: 'whitespace-nowrap',
      cell: (s) => {
        const startup = startupOf(s);
        return <Yn value={Boolean(startup?.homepage || startup?.links.length)} />;
      },
    },
    {
      key: 'request',
      header: '요청사항',
      align: 'center',
      className: 'whitespace-nowrap',
      cell: (s) => <Yn value={Boolean(s.counseling_request?.trim())} />,
    },
    {
      key: 'status',
      header: '진행상태',
      align: 'center',
      className: 'whitespace-nowrap',
      cell: (s) =>
        s.startup_id ? (
          <SessionStatusBadge status={s.session_status} />
        ) : (
          <span className="text-neutral-base/30">-</span>
        ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={slots}
      rowKey={(s) => s.id}
      minWidthClass="min-w-[920px]"
      emptyMessage="배정된 상담 일정이 없습니다."
      onRowClick={onOpen ? (s) => s.startup_id && onOpen(s) : undefined}
      rowClassName={(s) => (s.id === activeSlotId ? 'bg-brand/5' : '')}
    />
  );
}

function Yn({ value }: { value: boolean }) {
  return (
    <span className={value ? 'font-semibold text-brand' : 'text-neutral-base/40'}>
      {value ? 'Y' : 'N'}
    </span>
  );
}
