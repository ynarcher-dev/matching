import { useMemo } from 'react';
import { buildBookingSchedule } from '@/lib/booking';
import { formatDateTime } from '@/lib/datetime';
import { cellStateOf } from '@/lib/startupBooking';
import type { MatchingSlotRow } from '@/types/eventDetail';
import type { PortalExpert } from '@/types/startupBooking';
import { CELL } from './slotCellStyles';

interface TimeMatrixGridProps {
  experts: PortalExpert[];
  slots: MatchingSlotRow[];
  /** 전문가 기본 테이블 id → 테이블 코드(행 헤더 표기용). */
  tableCodeById: Map<string, string>;
  myId: string;
  maxSessions: number;
  allowDuplicateExpert: boolean;
  timezone: string;
  canBook: boolean;
  onBook: (slot: MatchingSlotRow) => void;
}

/** 시각만(HH:mm) 표기. */
function hhmm(iso: string, tz: string): string {
  return formatDateTime(iso, tz).slice(-5);
}

/**
 * 시간대별 보기 (page_startup_booking.md §1.2-3).
 * 전문가(행)×시간(열) **매트릭스 표**로 한눈에 빈 슬롯을 찾는 빠른 예약 탐색용 화면.
 * 열=시작시각, 행=전문가(테이블 코드순). 빈 슬롯=신청 가능·내 예약=강조·마감=회색.
 */
export function TimeMatrixGrid({
  experts,
  slots,
  tableCodeById,
  myId,
  maxSessions,
  allowDuplicateExpert,
  timezone,
  canBook,
  onBook,
}: TimeMatrixGridProps) {
  const expertById = useMemo(() => new Map(experts.map((e) => [e.userId, e])), [experts]);
  const { columns, byExpert } = useMemo(() => buildBookingSchedule(slots), [slots]);

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

  if (columns.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-neutral-base/60">
        아직 공개된 상담 슬롯이 없습니다. 행사 준비가 완료되면 일정표가 표시됩니다.
      </p>
    );
  }

  return (
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
                  <span className="mt-1 block text-sm font-bold text-neutral-base">{row.name}</span>
                  {row.org && (
                    <span className="block text-xs font-medium text-neutral-base/70">{row.org}</span>
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
                      className={`w-[92px] border-r border-border px-1 text-center align-middle text-[11px] font-bold outline-none transition-colors last:border-r-0 focus-visible:ring-2 focus-visible:ring-success ${
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
  );
}
