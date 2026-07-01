import { useMemo } from 'react';
import { Badge } from '@/components/common/Badge';
import { TableTag } from '@/components/common/TableTag';
import { formatDateTime } from '@/lib/datetime';
import { cellStateOf, isMine, slotsByExpert } from '@/lib/startupBooking';
import type { CellState } from '@/lib/startupBooking';
import type { MatchingSlotRow } from '@/types/eventDetail';
import type { PortalExpert } from '@/types/startupBooking';
import { ExpertAvatar } from './ExpertAvatar';
import { CELL } from './slotCellStyles';

interface ExpertBookingListProps {
  experts: PortalExpert[];
  slots: MatchingSlotRow[];
  /** 전문가 userId → 프로필 사진 Signed URL. */
  avatarUrls: Map<string, string>;
  /** 전문가 기본 테이블 id → 테이블 코드(위치 표기용). */
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
 * 전문가별 보기 (page_startup_booking.md §1.3).
 * 시간표를 전문가별로 나열하는 수준이 아니라, **전문가 정보 카드를 먼저** 보여주고
 * 그 전문가의 상담 가능 시간대를 함께 노출한다. 이미 예약한 전문가는 명확히 표시한다.
 */
export function ExpertBookingList({
  experts,
  slots,
  avatarUrls,
  tableCodeById,
  myId,
  maxSessions,
  allowDuplicateExpert,
  timezone,
  canBook,
  onBook,
}: ExpertBookingListProps) {
  const byExpert = useMemo(() => slotsByExpert(slots), [slots]);

  // 모든 참가 전문가를 노출(슬롯 없어도 정보 탐색용). 테이블 코드 → 이름 순.
  const rows = useMemo(() => {
    const list = experts.map((e) => ({
      expert: e,
      tableCode: e.defaultTableId
        ? (tableCodeById.get(e.defaultTableId) ?? '미지정')
        : '미지정',
    }));
    return list.sort(
      (a, b) =>
        a.tableCode.localeCompare(b.tableCode, 'ko') ||
        a.expert.name.localeCompare(b.expert.name, 'ko'),
    );
  }, [experts, tableCodeById]);

  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-neutral-base/60">
        아직 등록된 참가 전문가가 없습니다.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {rows.map(({ expert, tableCode }) => {
        const expertSlots = byExpert.get(expert.userId) ?? [];
        const bookedByMe = expertSlots.some((s) => isMine(s, myId));
        return (
          <li
            key={expert.userId}
            className="flex flex-col gap-3 rounded-xl border border-border bg-white p-4"
          >
            <div className="flex items-start gap-3">
              <ExpertAvatar url={avatarUrls.get(expert.userId) ?? null} name={expert.name} />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-base font-bold text-neutral-base">{expert.name}</span>
                  {expert.position && (
                    <span className="text-sm text-neutral-base/70">{expert.position}</span>
                  )}
                  <TableTag code={tableCode} />
                  {bookedByMe && (
                    <Badge tone="success">
                      예약함
                    </Badge>
                  )}
                </div>
                {expert.organization && (
                  <span className="text-sm font-medium text-neutral-base/80">
                    {expert.organization}
                  </span>
                )}
                {expert.fieldNames.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {expert.fieldNames.map((f) => (
                      <Badge key={f} tone="muted" className="font-medium text-neutral-base/80">
                        {f}
                      </Badge>
                    ))}
                  </div>
                )}
                {expert.description && (
                  <p className="whitespace-pre-wrap text-sm text-neutral-base/75">
                    {expert.description}
                  </p>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-1.5 border-t border-border pt-3">
              <span className="text-xs font-bold text-neutral-base/70">상담 가능 시간대</span>
              {bookedByMe && !allowDuplicateExpert ? (
                <p className="text-xs text-neutral-base/60">
                  이미 이 전문가와 예약했습니다. 이 행사에서는 동일 전문가 추가 예약이 제한됩니다.
                </p>
              ) : (
                bookedByMe && (
                  <p className="text-xs text-success">
                    이미 예약한 전문가입니다. 다른 시간대로 추가 예약할 수 있습니다.
                  </p>
                )
              )}
              {expertSlots.length === 0 ? (
                <p className="text-xs text-neutral-base/50">공개된 상담 시간대가 없습니다.</p>
              ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-1.5">
                  {expertSlots.map((slot) => {
                    const state = cellStateOf(
                      slot,
                      slots,
                      myId,
                      maxSessions,
                      canBook,
                      allowDuplicateExpert,
                    );
                    return (
                      <SlotChip
                        key={slot.id}
                        label={`${hhmm(slot.start_time, timezone)}~${hhmm(slot.end_time, timezone)}`}
                        state={state}
                        onClick={() => onBook(slot)}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** 전문가 카드 안의 시간대 칩: 시각 범위 + 상태. open 만 클릭 가능. */
function SlotChip({
  label,
  state,
  onClick,
}: {
  label: string;
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
      className={`flex flex-col items-center gap-0.5 rounded-lg border border-border px-2 py-2 text-center transition-colors disabled:cursor-default ${style.box}`}
    >
      <span className="text-xs font-bold">{label}</span>
      <span className="text-[11px] font-medium opacity-80">{style.label}</span>
    </button>
  );
}
