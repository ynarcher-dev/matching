import { useMemo } from 'react';
import { buildBookingSchedule } from '@/lib/booking';
import { attendanceStatusFor } from '@/lib/attendance';
import { formatDateTime } from '@/lib/datetime';
import {
  companyName,
  BOOKING_TYPE_LABELS,
  PARTICIPANT_ROLE_LABELS,
  SESSION_STATUS_LABELS,
} from '@/lib/labels';
import type { AttendanceLogRow, AttendanceStatus } from '@/types/attendance';
import type {
  AssignableUser,
  BookingType,
  EventParticipantRow,
  EventTable,
  MatchingSlotRow,
  SessionStatus,
} from '@/types/eventDetail';

interface TimeGridSheetProps {
  slots: MatchingSlotRow[];
  participants: EventParticipantRow[];
  tables: EventTable[];
  userById: Map<string, AssignableUser>;
  attendance: Map<string, AttendanceLogRow>;
  timezone: string;
  locked: boolean;
  /** 출석/노쇼 mutation 진행 중 — 셀 버튼 비활성. */
  pending: boolean;
  /** 스타트업 출석 상태 선택(미정=null / 출석 / 불참). */
  onSetStartup: (slot: MatchingSlotRow, next: AttendanceStatus | null) => void;
  /** 전문가 출석 상태 선택(관리자/스태프 대리, 미정=null / 출석 / 불참). */
  onSetExpert: (slot: MatchingSlotRow, next: AttendanceStatus | null) => void;
  /** 노쇼 처리(사유 모달 오픈). */
  onMarkNoShow: (slot: MatchingSlotRow) => void;
}

/** 예약 경로별 셀 배경/태그 색(page_admin_event_detail.md §3.1 — 수동=민트·AI=보라·강제=주황). */
const CELL_STYLE: Record<BookingType, { tint: string; pill: string }> = {
  NONE: { tint: '', pill: '' },
  MANUAL: { tint: 'bg-emerald-50', pill: 'bg-emerald-100 text-emerald-700' },
  AUTO_AI: { tint: 'bg-violet-50', pill: 'bg-violet-100 text-violet-700' },
  ADMIN_FORCE: { tint: 'bg-orange-50', pill: 'bg-orange-100 text-orange-700' },
};

/** 세션 진행 상태 배지 색(page_admin_event_detail.md §3.1 — 대기/진행/완료). */
const STATUS_TONE: Record<SessionStatus, string> = {
  WAITING: 'bg-neutral-100 text-neutral-600',
  IN_PROGRESS: 'bg-blue-100 text-blue-700',
  COMPLETED: 'bg-emerald-100 text-emerald-700',
  NO_SHOW: 'bg-red-100 text-red-700',
  CANCELLED: 'bg-neutral-100 text-neutral-400 line-through',
};

interface ExpertRow {
  expertId: string;
  name: string;
  org: string | null;
  tableCode: string;
}

/**
 * 실시간 진행 타임그리드 (page_admin_event_detail.md §3.1, 설계 §4 TimeGridSheet).
 * 행=전문가(테이블·이름·소속), 열=시작시각. 셀=[경로][세션상태] 배지 + 기업명 + 출석.
 * 스타트업 출석은 관리자가 원클릭 토글, 전문가 출석은 표시만(본인만 체크 가능).
 * 예약 배치 표(BookingScheduleTable)와 셀 디자인을 공유하되 진행·출석 조작을 더한다.
 */
export function TimeGridSheet({
  slots,
  participants,
  tables,
  userById,
  attendance,
  timezone,
  locked,
  pending,
  onSetStartup,
  onSetExpert,
  onMarkNoShow,
}: TimeGridSheetProps) {
  const { columns, byExpert } = useMemo(() => buildBookingSchedule(slots), [slots]);

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

  if (columns.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-neutral-base/60">
        아직 생성된 슬롯이 없습니다. 배치 단계에서 시간표 슬롯을 생성하면 진행 현황이 표시됩니다.
      </p>
    );
  }

  return (
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
                  className="w-[150px] whitespace-nowrap border-r border-border px-1 py-2 text-center font-bold last:border-r-0"
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
                <th className="sticky left-0 z-10 w-44 whitespace-nowrap border-r border-border bg-white px-3 py-2 text-left align-top">
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
                  return (
                    <td
                      key={c}
                      className="w-[150px] border-r border-border p-1 align-top last:border-r-0"
                    >
                      <GridCell
                        slot={slot}
                        userById={userById}
                        attendance={attendance}
                        locked={locked}
                        pending={pending}
                        onSetStartup={onSetStartup}
                        onSetExpert={onSetExpert}
                        onMarkNoShow={onMarkNoShow}
                      />
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** 한 칸: 진행 배지 + 기업명 + 전문가/스타트업 출석. */
function GridCell({
  slot,
  userById,
  attendance,
  locked,
  pending,
  onSetStartup,
  onSetExpert,
  onMarkNoShow,
}: {
  slot: MatchingSlotRow | undefined;
  userById: Map<string, AssignableUser>;
  attendance: Map<string, AttendanceLogRow>;
  locked: boolean;
  pending: boolean;
  onSetStartup: (slot: MatchingSlotRow, next: AttendanceStatus | null) => void;
  onSetExpert: (slot: MatchingSlotRow, next: AttendanceStatus | null) => void;
  onMarkNoShow: (slot: MatchingSlotRow) => void;
}) {
  if (!slot) return <span className="block text-center text-neutral-base/15">·</span>;
  if (!slot.startup_id) {
    return <span className="block py-2 text-center text-xs text-neutral-base/35">빈 슬롯</span>;
  }

  const startup = userById.get(slot.startup_id);
  const style = CELL_STYLE[slot.booking_type];
  const expertStatus = attendanceStatusFor(attendance, slot.id, slot.expert_id);
  const startupStatus = attendanceStatusFor(attendance, slot.id, slot.startup_id);
  const canNoShow =
    !locked && (slot.session_status === 'WAITING' || slot.session_status === 'IN_PROGRESS');

  return (
    <div className={`flex flex-col gap-1 rounded-md px-1 py-1.5 ${style.tint}`}>
      <div className="flex flex-wrap justify-center gap-0.5">
        <span
          className={`inline-block rounded-full px-1.5 py-0.5 text-[10px] font-bold ${style.pill}`}
        >
          {BOOKING_TYPE_LABELS[slot.booking_type]}
        </span>
        <span
          className={`inline-block rounded-full px-1.5 py-0.5 text-[10px] font-bold ${STATUS_TONE[slot.session_status]}`}
        >
          {SESSION_STATUS_LABELS[slot.session_status]}
        </span>
      </div>

      <p className="break-keep text-center text-xs font-bold leading-tight text-neutral-base">
        {startup ? companyName(startup) : '(알 수 없음)'}
      </p>

      <div className="flex flex-col items-stretch gap-1">
        <AttendanceControl
          label={PARTICIPANT_ROLE_LABELS.EXPERT}
          status={expertStatus}
          disabled={locked || pending}
          onSelect={(next) => onSetExpert(slot, next)}
        />
        <AttendanceControl
          label={PARTICIPANT_ROLE_LABELS.STARTUP}
          status={startupStatus}
          disabled={locked || pending}
          onSelect={(next) => onSetStartup(slot, next)}
        />
      </div>

      {canNoShow && (
        <button
          type="button"
          disabled={pending}
          onClick={() => onMarkNoShow(slot)}
          className="rounded-md border border-border px-1 py-0.5 text-[10px] font-semibold text-brand transition-colors hover:bg-danger-surface disabled:opacity-50"
        >
          노쇼 처리
        </button>
      )}
    </div>
  );
}

/** 출석 세그먼트 한 칸 정의(미정/출석/불참). */
const ATTENDANCE_SEGMENTS: {
  value: AttendanceStatus | null;
  mark: string;
  title: string;
  activeTone: string;
}[] = [
  { value: null, mark: '–', title: '미정', activeTone: 'bg-neutral-300 text-neutral-700' },
  { value: 'PRESENT', mark: '✓', title: '출석', activeTone: 'bg-emerald-500 text-white' },
  { value: 'ABSENT', mark: '✕', title: '불참', activeTone: 'bg-red-500 text-white' },
];

/**
 * 출석 세그먼트 컨트롤 [미정 | 출석 | 불참]. 현재 상태가 강조되고 나머지는 회색.
 * 실수로 눌러도 '미정'을 다시 선택해 기본 상태로 되돌릴 수 있다.
 */
function AttendanceControl({
  label,
  status,
  onSelect,
  disabled,
}: {
  label: string;
  status: AttendanceStatus | null;
  onSelect: (next: AttendanceStatus | null) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="w-10 shrink-0 text-[10px] font-semibold text-neutral-base/70">{label}</span>
      <div className="flex flex-1 overflow-hidden rounded-md border border-border">
        {ATTENDANCE_SEGMENTS.map((seg, i) => {
          const active = status === seg.value;
          return (
            <button
              key={seg.title}
              type="button"
              disabled={disabled || active}
              title={seg.title}
              aria-label={`${label} ${seg.title}`}
              aria-pressed={active}
              onClick={() => onSelect(seg.value)}
              className={`flex-1 px-1 py-0.5 text-[11px] font-bold transition-colors ${
                i > 0 ? 'border-l border-border' : ''
              } ${
                active
                  ? seg.activeTone
                  : 'bg-white text-neutral-base/35 hover:bg-surface disabled:opacity-100'
              }`}
            >
              {seg.mark}
            </button>
          );
        })}
      </div>
    </div>
  );
}
