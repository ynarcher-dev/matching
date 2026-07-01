import { Badge } from '@/components/common/Badge';
import { Button } from '@/components/common/Button';
import { DataTable } from '@/components/common/DataTable';
import { SessionStatusBadge } from '@/components/expert/SessionStatusBadge';
import { attendanceStatusFor } from '@/lib/attendance';
import { formatDateTime } from '@/lib/datetime';
import type { DataTableColumn } from '@/components/common/DataTable';
import type { AttendanceLogRow } from '@/types/attendance';
import type { MatchingSlotRow } from '@/types/eventDetail';
import type { SlotStartup } from '@/types/expert';

/**
 * 전체 상담 일정 표 (docs/expert_dashboard_split_view_ideation.md §2A).
 * 관리자 페이지와 동일한 공통 DataTable 마크업을 사용한다. 컬럼: 시간·기업명·매칭테이블·
 * 진행상태·출석(전/스)·작업. 예약된 행을 클릭하면 Split View 워크스페이스로 진입한다.
 */
export function ExpertScheduleTable({
  slots,
  startupById,
  tableCodeById,
  attendanceMap,
  activeSlotId,
  timezone,
  onOpen,
}: {
  slots: MatchingSlotRow[];
  startupById: Map<string, SlotStartup>;
  tableCodeById: Map<string, string>;
  attendanceMap: Map<string, AttendanceLogRow>;
  activeSlotId: string | null;
  timezone: string;
  /** 예약된 슬롯을 열 때 호출(워크스페이스 진입). 미지정 시 작업 버튼 숨김. */
  onOpen?: (slot: MatchingSlotRow) => void;
}) {
  const hm = (iso: string) => formatDateTime(iso, timezone).slice(-5);

  const columns: DataTableColumn<MatchingSlotRow>[] = [
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
        const su = startupById.get(s.startup_id);
        return (
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-neutral-base">
              {su?.companyName ?? su?.name ?? '(스타트업)'}
            </span>
            {su?.representativeName && (
              <span className="text-xs text-neutral-base/55">대표 {su.representativeName}</span>
            )}
          </div>
        );
      },
    },
    {
      key: 'table',
      header: '매칭테이블',
      align: 'center',
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
      key: 'status',
      header: '진행상태',
      align: 'center',
      cell: (s) =>
        s.startup_id ? (
          <SessionStatusBadge status={s.session_status} />
        ) : (
          <span className="text-neutral-base/30">-</span>
        ),
    },
    {
      key: 'attendance',
      header: '출석 (전/스)',
      align: 'center',
      cell: (s) => {
        if (!s.startup_id) return <span className="text-neutral-base/30">-</span>;
        return (
          <span className="inline-flex gap-1">
            <AttendanceChip label="전" present={attendanceStatusFor(attendanceMap, s.id, s.expert_id)} />
            <AttendanceChip
              label="스"
              present={attendanceStatusFor(attendanceMap, s.id, s.startup_id)}
            />
          </span>
        );
      },
    },
    {
      key: 'action',
      header: '작업',
      align: 'center',
      className: 'whitespace-nowrap',
      cell: (s) => {
        if (!s.startup_id || !onOpen) return <span className="text-neutral-base/30">-</span>;
        const completed = s.session_status === 'COMPLETED';
        return (
          <Button
            variant={completed ? 'outline' : 'primary'}
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onOpen(s);
            }}
          >
            {completed ? '일지 보기/수정' : '일지 작성'}
          </Button>
        );
      },
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={slots}
      rowKey={(s) => s.id}
      minWidthClass="min-w-[760px]"
      emptyMessage="배정된 상담 슬롯이 없습니다."
      onRowClick={onOpen ? (s) => s.startup_id && onOpen(s) : undefined}
      // 활성(현재 시각) 슬롯 식별용 — DataTable 자체엔 행 강조 hook 이 없어 onRowClick 으로만 진입.
      rowClassName={(s) => (s.id === activeSlotId ? 'bg-brand/5' : '')}
    />
  );
}

/** 출석 상태 칩: 출석=초록, 불참=레드, 미정=회색. */
function AttendanceChip({ label, present }: { label: string; present: 'PRESENT' | 'ABSENT' | null }) {
  const tone = present === 'PRESENT' ? 'success' : present === 'ABSENT' ? 'danger' : 'muted';
  const mark = present === 'PRESENT' ? '✓' : present === 'ABSENT' ? '✕' : '–';
  return (
    <Badge tone={tone} size="11">
      {label} {mark}
    </Badge>
  );
}
