import { useMemo } from 'react';
import { Badge } from '@/components/common/Badge';
import { Card } from '@/components/common/Card';
import { TableTag } from '@/components/common/TableTag';
import { SaveStatus } from '@/components/common/SaveStatus';
import { formatRange } from '@/lib/datetime';
import { myBookedSlots } from '@/lib/startupBooking';
import { useAutoSaveText } from '@/hooks/useAutoSaveText';
import { useSetCounselingRequest, type EventTableInfo } from '@/hooks/useStartupPortal';
import type { MatchingSlotRow } from '@/types/eventDetail';
import type { PortalExpert } from '@/types/startupBooking';

/** 상담 희망사항 최대 길이(set_counseling_request RPC 와 정합). */
const COUNSELING_REQUEST_MAX = 1000;

interface CounselingRequestPanelProps {
  slots: MatchingSlotRow[];
  expertById: Map<string, PortalExpert>;
  tableInfoById: Map<string, EventTableInfo>;
  myId: string;
  eventId: string;
  timezone: string;
  /** 종료 행사면 읽기 전용. */
  editable: boolean;
}

/** 슬롯의 실제 적용 테이블 정보(table_id 우선, 없으면 전문가 기본 테이블). MyBookingList 와 동일. */
function tableInfoFor(
  slot: MatchingSlotRow,
  expert: PortalExpert | undefined,
  tableInfoById: Map<string, EventTableInfo>,
): EventTableInfo | null {
  const id = slot.table_id ?? expert?.defaultTableId ?? null;
  return id ? (tableInfoById.get(id) ?? null) : null;
}

/**
 * 상담 전문가별 요청사항 카드 (자료 첨부 §1).
 * '예약 및 조회'(MyBookingList)의 예약 카드 디자인을 그대로 차용하고,
 * 각 카드에 전문가별 요청사항 입력 필드박스(자동 저장)를 더한다.
 */
export function CounselingRequestPanel({
  slots,
  expertById,
  tableInfoById,
  myId,
  eventId,
  timezone,
  editable,
}: CounselingRequestPanelProps) {
  const mine = useMemo(() => myBookedSlots(slots, myId), [slots, myId]);
  const setRequestM = useSetCounselingRequest(eventId);

  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-bold text-neutral-base">상담 전문가별 요청사항</h2>
        <p className="text-sm text-neutral-base/70">
          예약한 상담별로 전문가에게 미리 전달할 핵심 질문이나 고민거리를 적어 주세요. 입력하면 자동
          저장되며, 전문가가 상담 전 확인합니다.
        </p>
      </div>

      {mine.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-neutral-base/60">
          아직 예약한 상담이 없습니다. `예약 및 조회`에서 상담을 예약하면 이곳에서 요청사항을 작성할 수
          있습니다.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {mine.map((slot) => {
            const expert = expertById.get(slot.expert_id);
            const table = tableInfoFor(slot, expert, tableInfoById);
            return (
              <li
                key={slot.id}
                className="flex flex-col gap-3 rounded-xl border border-border bg-surface-raised px-4 py-3.5 shadow-sm"
              >
                {/* 헤더: 상담 시간 + 확정 상태 (예약 카드 디자인 차용) */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span aria-hidden className="text-lg leading-none">🗓️</span>
                    <span className="text-sm font-bold text-neutral-base sm:text-base">
                      {formatRange(slot.start_time, slot.end_time, timezone)}
                    </span>
                  </div>
                  <Badge tone="success" icon="✓">
                    예약 확정
                  </Badge>
                </div>

                {/* 본문: 전문가 · 배정 테이블 */}
                <div className="flex flex-col gap-2 border-t border-border/70 pt-3">
                  <div className="flex items-center gap-2 text-sm">
                    <span aria-hidden className="w-5 text-center text-neutral-base/45">👤</span>
                    <span className="font-semibold text-neutral-base">
                      {expert?.name ?? '(알 수 없는 전문가)'}
                    </span>
                    {expert?.organization && (
                      <span className="text-neutral-base/60">· {expert.organization}</span>
                    )}
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-2 text-sm">
                      <span aria-hidden className="w-5 text-center text-neutral-base/45">📍</span>
                      <span className="text-neutral-base/70">배정 테이블</span>
                      {table?.code ? (
                        <TableTag code={table.code} />
                      ) : (
                        <span className="text-neutral-base/50">미지정</span>
                      )}
                    </div>
                    {table?.description && (
                      <p className="pl-7 text-xs text-neutral-base/60">{table.description}</p>
                    )}
                  </div>
                </div>

                {/* 요청사항 입력 필드박스 */}
                <div className="flex flex-col gap-1.5 border-t border-border/70 pt-3">
                  <CounselingRequestEditor
                    slot={slot}
                    editable={editable}
                    onSave={(request) =>
                      setRequestM.mutateAsync({ slotId: slot.id, request })
                    }
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/**
 * 슬롯별 상담 요청사항 입력기 (docs/expert_dashboard_split_view_ideation.md §3②).
 * 입력이 멈추면 자동 저장한다. 종료 행사(editable=false)는 읽기 전용.
 */
function CounselingRequestEditor({
  slot,
  editable,
  onSave,
}: {
  slot: MatchingSlotRow;
  editable: boolean;
  onSave: (request: string) => Promise<void>;
}) {
  const initial = slot.counseling_request ?? '';
  const { value, setValue, status, error } = useAutoSaveText({
    initial,
    onSave,
    transform: (v) => v.trim(),
  });

  if (!editable) {
    // 종료 행사 등 편집 불가: 입력된 요청사항만 읽기 전용으로 노출(없으면 안내).
    return (
      <>
        <span className="text-xs font-semibold text-neutral-base/70">✍️ 요청사항</span>
        {initial ? (
          <p className="whitespace-pre-wrap text-sm text-neutral-base/90">{initial}</p>
        ) : (
          <p className="text-xs text-neutral-base/50">작성된 요청사항이 없습니다.</p>
        )}
      </>
    );
  }

  return (
    <>
      <span className="text-xs font-semibold text-neutral-base/70">✍️ 요청사항</span>
      <textarea
        rows={3}
        maxLength={COUNSELING_REQUEST_MAX}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="자문받고 싶은 핵심 질문이나 간단한 고민거리를 적어 주세요."
        className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-neutral-base outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/30"
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-neutral-base/50">
          {value.length} / {COUNSELING_REQUEST_MAX}
        </span>
        <SaveStatus status={status} error={error} />
      </div>
    </>
  );
}
