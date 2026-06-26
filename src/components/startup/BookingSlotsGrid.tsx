import { useMemo, useState } from 'react';
import { Card } from '@/components/common/Card';
import { Alert } from '@/components/common/Alert';
import { buildBookingSchedule } from '@/lib/booking';
import { formatDateTime, formatRange } from '@/lib/datetime';
import { bookingBlockReason, isAvailable, isMine, slotsByTime } from '@/lib/startupBooking';
import type { MatchingSlotRow } from '@/types/eventDetail';
import type { PortalExpert } from '@/types/startupBooking';

interface BookingSlotsGridProps {
  experts: PortalExpert[];
  slots: MatchingSlotRow[];
  /** 전문가 기본 테이블 id → 테이블 코드(행 헤더 표기용). */
  tableCodeById: Map<string, string>;
  myId: string;
  maxSessions: number;
  /** 행사 설정: 동일 전문가 2회 이상 예약 허용. */
  allowDuplicateExpert: boolean;
  timezone: string;
  /** BOOKING 단계에서만 신규 예약 가능. */
  canBook: boolean;
  onBook: (slot: MatchingSlotRow) => void;
}

type GridTab = 'matrix' | 'time';

const GRID_TABS: { value: GridTab; label: string }[] = [
  { value: 'matrix', label: '전문가별 보기' },
  { value: 'time', label: '시간대별 보기' },
];

/** 시각만(HH:mm) 표기. */
function hhmm(iso: string, tz: string): string {
  return formatDateTime(iso, tz).slice(-5);
}

/** 셀 상태 4종 — 한눈에 보기 위해 색/라벨을 단일 매핑한다. */
type CellState = 'open' | 'blocked' | 'taken' | 'mine' | 'none';

function cellStateOf(
  slot: MatchingSlotRow | undefined,
  allSlots: MatchingSlotRow[],
  myId: string,
  maxSessions: number,
  canBook: boolean,
  allowDuplicateExpert: boolean,
): CellState {
  if (!slot) return 'none';
  if (isMine(slot, myId)) return 'mine';
  if (!isAvailable(slot)) return 'taken';
  if (!canBook) return 'blocked';
  return bookingBlockReason(allSlots, slot, myId, maxSessions, { allowDuplicateExpert })
    ? 'blocked'
    : 'open';
}

/**
 * 예약 신청 일정표 (page_startup_booking.md §1.2-3, §2.1).
 * 기본은 전문가(행)×시간(열) **매트릭스 표**로 한눈에 보여준다(관리자 예약현황과 동일 스캐폴드).
 * 시간대별 탭은 좁은 화면용 세로 목록. 빈 슬롯=민트(신청)·내 예약=강조·마감=회색.
 */
export function BookingSlotsGrid({
  experts,
  slots,
  tableCodeById,
  myId,
  maxSessions,
  allowDuplicateExpert,
  timezone,
  canBook,
  onBook,
}: BookingSlotsGridProps) {
  const [tab, setTab] = useState<GridTab>('matrix');

  const expertById = useMemo(() => new Map(experts.map((e) => [e.userId, e])), [experts]);
  const { columns, byExpert } = useMemo(() => buildBookingSchedule(slots), [slots]);
  const { columns: timeColumns, byTime } = useMemo(() => slotsByTime(slots), [slots]);

  // 열(시작시각)별 종료시각 — 헤더 "시작 ~ 종료" 표기용.
  const endByStart = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of slots) {
      if (s.session_status === 'CANCELLED') continue;
      if (!m.has(s.start_time)) m.set(s.start_time, s.end_time);
    }
    return m;
  }, [slots]);

  // 슬롯 있는 전문가만 행으로. 테이블 코드 → 이름 순(같은 테이블끼리 모이게).
  const expertRows = useMemo(() => {
    const rows = [...byExpert.keys()].map((expertId) => {
      const e = expertById.get(expertId);
      const tid = e?.defaultTableId ?? null;
      return {
        expertId,
        name: e?.name ?? '(알 수 없는 전문가)',
        org: e?.organization ?? null,
        tableCode: tid ? (tableCodeById.get(tid) ?? '미지정') : '미지정',
      };
    });
    return rows.sort(
      (a, b) =>
        a.tableCode.localeCompare(b.tableCode, 'ko') || a.name.localeCompare(b.name, 'ko'),
    );
  }, [byExpert, expertById, tableCodeById]);

  const handleClick = (slot: MatchingSlotRow) => {
    if (cellStateOf(slot, slots, myId, maxSessions, canBook, allowDuplicateExpert) === 'open') {
      onBook(slot);
    }
  };

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-bold text-neutral-base">예약 신청 일정표</h2>
        <div className="flex gap-1.5">
          {GRID_TABS.map((t) => {
            const active = tab === t.value;
            return (
              <button
                key={t.value}
                type="button"
                onClick={() => setTab(t.value)}
                className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors ${
                  active
                    ? 'border-brand bg-brand text-white'
                    : 'border-border bg-white text-neutral-base hover:bg-surface'
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <Legend />

      {!canBook && (
        <Alert tone="info">
          현재 예약 단계가 아니어서 새 슬롯을 신청할 수 없습니다. 예약(BOOKING) 단계에서 신청할 수 있습니다.
        </Alert>
      )}

      {columns.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-neutral-base/60">
          아직 공개된 상담 슬롯이 없습니다. 행사 준비가 완료되면 일정표가 표시됩니다.
        </p>
      ) : tab === 'matrix' ? (
        <div className="w-fit max-w-full overflow-x-auto rounded-xl border border-border">
          <table className="border-collapse text-left text-sm">
            <thead>
              <tr className="border-b-2 border-border bg-surface text-neutral-base">
                <th className="sticky left-0 z-10 w-40 whitespace-nowrap border-r border-border bg-surface px-3 py-2.5 font-bold">
                  테이블 · 전문가
                </th>
                {columns.map((c) => (
                  <th
                    key={c}
                    className="w-[92px] whitespace-nowrap border-r border-border px-1 py-2 text-center font-bold last:border-r-0"
                  >
                    <span className="block text-sm">{hhmm(c, timezone)}</span>
                    {endByStart.get(c) && (
                      <span className="block text-xs font-medium text-neutral-base/55">
                        ~{hhmm(endByStart.get(c)!, timezone)}
                      </span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {expertRows.map((row) => {
                const cells = byExpert.get(row.expertId);
                return (
                  <tr key={row.expertId} className="border-b border-border last:border-b-0">
                    <th className="sticky left-0 z-10 w-40 whitespace-nowrap border-r border-border bg-white px-3 py-2 text-left align-middle">
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
                      const state = cellStateOf(
                        slot,
                        slots,
                        myId,
                        maxSessions,
                        canBook,
                        allowDuplicateExpert,
                      );
                      const meta = CELL[state];
                      const clickable = state === 'open' && Boolean(slot);
                      return (
                        <td
                          key={c}
                          role={clickable ? 'button' : undefined}
                          tabIndex={clickable ? 0 : undefined}
                          onClick={clickable ? () => handleClick(slot!) : undefined}
                          onKeyDown={
                            clickable
                              ? (e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    handleClick(slot!);
                                  }
                                }
                              : undefined
                          }
                          className={`w-[92px] border-r border-border px-1 text-center align-middle text-[11px] font-bold outline-none transition-colors last:border-r-0 focus-visible:ring-2 focus-visible:ring-emerald-400 ${
                            state === 'none' ? 'text-neutral-base/15' : meta.box
                          }`}
                        >
                          {meta.label}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {timeColumns.map((col) => {
            const end = byTime.get(col)?.[0]?.end_time ?? col;
            return (
              <div key={col} className="flex flex-col gap-2">
                <h3 className="text-sm font-bold text-neutral-base">
                  {formatRange(col, end, timezone)}
                </h3>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                  {(byTime.get(col) ?? []).map((slot) => (
                    <TimeChip
                      key={slot.id}
                      expertName={expertById.get(slot.expert_id)?.name ?? '전문가'}
                      state={cellStateOf(
                        slot,
                        slots,
                        myId,
                        maxSessions,
                        canBook,
                        allowDuplicateExpert,
                      )}
                      onClick={() => handleClick(slot)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

/**
 * 셀 상태별 색/라벨. 색은 셀(td) 전체에 입혀 위아래 여백 없이 꽉 채운다.
 * 내 예약=채운 진초록(✓), 신청 가능=연초록 — 채움 vs 연함으로 구분. 마감/신청 불가=동일 회색.
 */
const CELL: Record<CellState, { box: string; label: string }> = {
  open: { box: 'cursor-pointer bg-white text-emerald-600 hover:bg-emerald-50', label: '신청 가능' },
  mine: { box: 'bg-emerald-600 text-white', label: '✓ 내 예약' },
  taken: { box: 'bg-surface text-neutral-base/40', label: '마감' },
  blocked: { box: 'bg-surface text-neutral-base/40', label: '신청 불가' },
  none: { box: '', label: '·' },
};

/** 시간대별 목록 칩: 전문가명 + 상태. open 만 클릭 가능. 텍스트색은 box 에서 상속. */
function TimeChip({
  expertName,
  state,
  onClick,
}: {
  expertName: string;
  state: CellState;
  onClick: () => void;
}) {
  const style = CELL[state === 'none' ? 'blocked' : state];
  const clickable = state === 'open';
  return (
    <button
      type="button"
      disabled={!clickable}
      onClick={onClick}
      className={`flex flex-col items-center gap-0.5 rounded-lg border border-border px-2 py-3 text-center transition-colors disabled:cursor-default ${style.box}`}
    >
      <span className="text-sm font-bold">{expertName}</span>
      <span className="text-[11px] font-medium opacity-80">{style.label}</span>
    </button>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap gap-3 text-[11px] text-neutral-base/70">
      <LegendItem className="border-emerald-400 bg-white" label="신청 가능" />
      <LegendItem className="border-emerald-600 bg-emerald-600" label="내 예약" />
      <LegendItem className="border-border bg-surface" label="마감 / 신청 불가" />
    </div>
  );
}

function LegendItem({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block h-3.5 w-3.5 rounded border ${className}`} />
      {label}
    </span>
  );
}
