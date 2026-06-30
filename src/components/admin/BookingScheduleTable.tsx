import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { Badge } from '@/components/common/Badge';
import { Card } from '@/components/common/Card';
import { buildBookingSchedule } from '@/lib/booking';
import { formatDateTime } from '@/lib/datetime';
import { companyName, BOOKING_TYPE_LABELS } from '@/lib/labels';
import type { Tone } from '@/lib/tone';
import type {
  AssignableUser,
  BookingType,
  EventParticipantRow,
  EventTable,
  MatchingSlotRow,
} from '@/types/eventDetail';

interface BookingScheduleTableProps {
  slots: MatchingSlotRow[];
  participants: EventParticipantRow[];
  tables: EventTable[];
  userById: Map<string, AssignableUser>;
  timezone: string;
  /** 빈 슬롯 클릭 시 호출(강제 배정 모달 열기). 없으면 빈 슬롯은 비활성 표시. */
  onSelectEmptySlot?: (slot: MatchingSlotRow) => void;
  /** 제목 우측 액션 버튼(강제 배치 · AI배치 등). */
  headerActions?: ReactNode;
}

/** 예약 경로별 태그 tone(page_admin_event_detail.md §3.1 — 수동=success·AI=ai·강제=warning, 9-A tone). */
const TYPE_TONE: Record<BookingType, Tone> = {
  NONE: 'muted',
  MANUAL: 'success',
  AUTO_AI: 'ai',
  ADMIN_FORCE: 'warning',
};

/** 한 전문가 행의 표시 정보(테이블·이름·소속). */
interface ExpertRow {
  expertId: string;
  name: string;
  org: string | null;
  tableCode: string;
}

/**
 * 예약 배치 현황 표 (page_admin_event_detail.md §2.2 보강).
 * 행=전문가(테이블명·이름·소속 3줄), 열=시간, 셀=[예약경로 태그]+기업명. 세로/가로 그리드선.
 * 관리자 운영용 정적 표 — 진행단계 실시간 타임그리드/출석(§3.1)과 셀 디자인을 공유한다.
 */
export function BookingScheduleTable({
  slots,
  participants,
  tables,
  userById,
  timezone,
  onSelectEmptySlot,
  headerActions,
}: BookingScheduleTableProps) {
  const { columns, byExpert } = useMemo(() => buildBookingSchedule(slots), [slots]);

  // 열(시작시각)별 종료시각 — 헤더에 "시작 ~ 종료" 표기용.
  const endByStart = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of slots) {
      if (s.session_status === 'CANCELLED') continue;
      if (!m.has(s.start_time)) m.set(s.start_time, s.end_time);
    }
    return m;
  }, [slots]);

  const tableCodeById = useMemo(
    () => new Map(tables.map((t) => [t.id, t.table_code])),
    [tables],
  );
  const defaultTableByExpert = useMemo(
    () => new Map(participants.map((p) => [p.user_id, p.default_table_id])),
    [participants],
  );

  // 슬롯이 있는 전문가만 행으로. 테이블 코드 → 전문가명 순 정렬(같은 테이블끼리 모이게).
  const expertRows = useMemo<ExpertRow[]>(() => {
    const rows = [...byExpert.keys()].map((expertId) => {
      const u = userById.get(expertId);
      const tid = defaultTableByExpert.get(expertId) ?? null;
      return {
        expertId,
        name: u?.name ?? '(알 수 없는 전문가)',
        org: u?.expert_organization ?? null,
        tableCode: tid ? (tableCodeById.get(tid) ?? '미지정') : '미지정',
      };
    });
    return rows.sort(
      (a, b) =>
        a.tableCode.localeCompare(b.tableCode, 'ko') || a.name.localeCompare(b.name, 'ko'),
    );
  }, [byExpert, userById, defaultTableByExpert, tableCodeById]);

  return (
    <Card className="flex flex-col gap-3 p-5">
      {/* 제목 좌측 · 경로 범례(+액션)는 우측 정렬 — 기업별 배치 현황과 동일한 헤더 레이아웃. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-bold text-neutral-base">예약 배치 현황</h3>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="success" size="11">
            {BOOKING_TYPE_LABELS.MANUAL}
          </Badge>
          <Badge tone="ai" size="11">
            {BOOKING_TYPE_LABELS.AUTO_AI}
          </Badge>
          <Badge tone="warning" size="11">
            {BOOKING_TYPE_LABELS.ADMIN_FORCE}
          </Badge>
          {headerActions}
        </div>
      </div>

      {columns.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-neutral-base/60">
          아직 생성된 슬롯이 없습니다. 배치 탭에서 시간표 슬롯을 생성하면 배치 현황이 표시됩니다.
        </p>
      ) : (
        <div className="w-fit max-w-full overflow-x-auto rounded-xl border border-border">
          <table className="border-collapse text-left text-sm">
            <thead>
              <tr className="border-b-2 border-border bg-surface text-neutral-base">
                <th className="sticky left-0 z-10 w-44 whitespace-nowrap border-r border-border bg-surface px-3 py-2.5 font-bold">
                  테이블 · 전문가
                </th>
                {columns.map((c) => {
                  const end = endByStart.get(c);
                  return (
                    <th
                      key={c}
                      className="w-[96px] whitespace-nowrap border-r border-border px-1 py-2 text-center font-bold last:border-r-0"
                    >
                      <span className="block text-sm text-neutral-base">
                        {formatDateTime(c, timezone).slice(-5)}
                      </span>
                      {end && (
                        <span className="block text-xs font-medium text-neutral-base/55">
                          ~{formatDateTime(end, timezone).slice(-5)}
                        </span>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {expertRows.map((row) => {
                const cells = byExpert.get(row.expertId);
                return (
                  <tr key={row.expertId} className="border-b border-border last:border-b-0">
                    <th className="sticky left-0 z-10 w-44 whitespace-nowrap border-r border-border bg-white px-3 py-2 text-left align-middle">
                      <span className="inline-block rounded bg-neutral-base px-2 py-0.5 text-xs font-bold text-white">
                        {row.tableCode}
                      </span>
                      <span className="mt-1 block text-sm font-bold text-neutral-base">
                        {row.name}
                      </span>
                      {row.org && (
                        <span className="block text-xs font-medium text-neutral-base/70">
                          {row.org}
                        </span>
                      )}
                    </th>
                    {columns.map((c) => {
                      const slot = cells?.get(c);
                      const su = slot?.startup_id ? userById.get(slot.startup_id) : undefined;
                      return (
                        <td
                          key={c}
                          className="w-[96px] border-r border-border p-1 align-middle last:border-r-0"
                        >
                          <Cell slot={slot} startup={su} onSelectEmptySlot={onSelectEmptySlot} />
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/** 셀: [예약경로 태그] + 기업명 / 빈 슬롯 / 슬롯 없음. */
function Cell({
  slot,
  startup,
  onSelectEmptySlot,
}: {
  slot: MatchingSlotRow | undefined;
  startup: AssignableUser | undefined;
  onSelectEmptySlot?: (slot: MatchingSlotRow) => void;
}) {
  if (!slot) return <span className="block text-center text-neutral-base/15">·</span>;
  if (!slot.startup_id) {
    // 빈 슬롯: 강제 배정 권한이 있으면 클릭해 모달을 연다.
    if (onSelectEmptySlot) {
      return (
        <button
          type="button"
          onClick={() => onSelectEmptySlot(slot)}
          className="block w-full rounded-md border border-dashed border-border py-1.5 text-xs font-medium text-neutral-base/45 transition-colors hover:border-brand hover:bg-danger-surface hover:text-brand"
          title="강제 배정"
        >
          + 배정
        </button>
      );
    }
    return <span className="block py-1 text-center text-xs text-neutral-base/35">빈 슬롯</span>;
  }
  return (
    <div className="flex flex-col items-center gap-1.5 px-1 py-1.5 text-center">
      <Badge tone={TYPE_TONE[slot.booking_type]} size="11">
        {BOOKING_TYPE_LABELS[slot.booking_type]}
      </Badge>
      <p className="break-keep text-xs font-bold leading-tight text-neutral-base">
        {startup ? companyName(startup) : '(알 수 없음)'}
      </p>
      {startup?.representative_name && (
        <p className="break-keep text-[11px] font-medium leading-tight text-neutral-base/60">
          {startup.representative_name}
        </p>
      )}
    </div>
  );
}
