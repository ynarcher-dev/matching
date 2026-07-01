import { useMemo, useState } from 'react';
import { Badge } from '@/components/common/Badge';
import { Card } from '@/components/common/Card';
import { Button } from '@/components/common/Button';
import { formatRange } from '@/lib/datetime';
import { myBookedSlots } from '@/lib/startupBooking';
import { useSetCounselingRequest } from '@/hooks/useStartupPortal';
import type { MatchingSlotRow } from '@/types/eventDetail';
import type { PortalExpert } from '@/types/startupBooking';

/** 상담 희망사항 최대 길이(set_counseling_request RPC 와 정합). */
const COUNSELING_REQUEST_MAX = 1000;

interface MyBookingListProps {
  slots: MatchingSlotRow[];
  expertById: Map<string, PortalExpert>;
  tableCodeById: Map<string, string>;
  myId: string;
  eventId: string;
  maxSessions: number;
  timezone: string;
  /** BOOKING(또는 자율예약 허용)일 때만 변경/취소 노출. */
  canModify: boolean;
  /** 종료 행사면 희망사항 편집 비활성(읽기 전용). */
  requestEditable: boolean;
  onChange: (slot: MatchingSlotRow) => void;
  onCancel: (slot: MatchingSlotRow) => void;
}

/** 슬롯의 실제 적용 테이블 코드(table_id 우선, 없으면 전문가 기본 테이블). */
function tableCodeFor(
  slot: MatchingSlotRow,
  expert: PortalExpert | undefined,
  tableCodeById: Map<string, string>,
): string | null {
  const id = slot.table_id ?? expert?.defaultTableId ?? null;
  return id ? (tableCodeById.get(id) ?? null) : null;
}

/**
 * 나의 매칭 예약 현황 (page_startup_booking.md §1.2-2).
 * 예약 완료 세션의 시간·전문가·테이블을 카드로 보여주고, 변경/취소 버튼을 배치한다.
 * 상단에 `예약 현황: N회 / 최대 M회` 요약 배지를 노출한다.
 */
export function MyBookingList({
  slots,
  expertById,
  tableCodeById,
  myId,
  eventId,
  maxSessions,
  timezone,
  canModify,
  requestEditable,
  onChange,
  onCancel,
}: MyBookingListProps) {
  const mine = useMemo(() => myBookedSlots(slots, myId), [slots, myId]);
  const setRequestM = useSetCounselingRequest(eventId);

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-bold text-neutral-base">나의 매칭 예약</h2>
        <Badge tone="success">
          예약 현황: {mine.length}회 / 최대 {maxSessions}회
        </Badge>
      </div>

      {mine.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-neutral-base/60">
          아직 예약한 상담이 없습니다. 아래 일정표에서 빈 슬롯을 선택해 신청해 주세요.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {mine.map((slot) => {
            const expert = expertById.get(slot.expert_id);
            const code = tableCodeFor(slot, expert, tableCodeById);
            return (
              <li
                key={slot.id}
                className="flex flex-col gap-3 rounded-xl border border-border bg-surface px-4 py-3"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-bold text-neutral-base">
                      {formatRange(slot.start_time, slot.end_time, timezone)}
                    </span>
                    <span className="text-sm text-neutral-base">
                      {expert?.name ?? '(알 수 없는 전문가)'}
                      {expert?.organization ? ` · ${expert.organization}` : ''}
                    </span>
                    <span className="text-xs font-medium text-neutral-base/70">
                      배정 테이블: {code ?? '미지정'}
                    </span>
                  </div>
                  {canModify && (
                    <div className="flex shrink-0 gap-2">
                      <Button
                        variant="outline"
                        onClick={() => onChange(slot)}
                        className="px-3 py-1.5 text-sm"
                      >
                        시간 변경
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => onCancel(slot)}
                        className="px-3 py-1.5 text-sm text-brand"
                      >
                        예약 취소
                      </Button>
                    </div>
                  )}
                </div>
                <CounselingRequestEditor
                  slot={slot}
                  editable={requestEditable}
                  saving={setRequestM.isPending}
                  error={setRequestM.isError ? (setRequestM.error as Error).message : null}
                  onSave={(request) => setRequestM.mutate({ slotId: slot.id, request })}
                />
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/**
 * 슬롯별 상담 희망사항 입력기 (docs/expert_dashboard_split_view_ideation.md §3②).
 * 전문가 Split View [요청] 탭에 노출될 '간단한 고민거리·핵심 질문'을 스타트업이 입력한다.
 * 슬롯의 현재 값으로 시드하고, 변경 시에만 저장 버튼을 활성화한다.
 */
function CounselingRequestEditor({
  slot,
  editable,
  saving,
  error,
  onSave,
}: {
  slot: MatchingSlotRow;
  editable: boolean;
  saving: boolean;
  error: string | null;
  onSave: (request: string) => void;
}) {
  const initial = slot.counseling_request ?? '';
  const [value, setValue] = useState(initial);
  const [justSaved, setJustSaved] = useState(false);
  const dirty = value.trim() !== initial.trim();

  if (!editable) {
    // 종료 행사 등 편집 불가: 입력된 희망사항만 읽기 전용으로 노출(없으면 숨김).
    if (!initial) return null;
    return (
      <div className="flex flex-col gap-1 border-t border-border pt-3">
        <span className="text-xs font-bold text-neutral-base/70">상담 희망사항</span>
        <p className="whitespace-pre-wrap text-sm text-neutral-base/90">{initial}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 border-t border-border pt-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-neutral-base/70">
          상담 희망사항{' '}
          <span className="font-normal text-neutral-base/50">
            (전문가가 상담 전 미리 확인합니다)
          </span>
        </span>
        {justSaved && !dirty && <span className="text-xs text-success">✓ 저장됨</span>}
      </div>
      <textarea
        rows={2}
        maxLength={COUNSELING_REQUEST_MAX}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setJustSaved(false);
        }}
        placeholder="자문받고 싶은 핵심 질문이나 간단한 고민거리를 적어 주세요."
        className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-neutral-base outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/30"
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-neutral-base/50">
          {value.length} / {COUNSELING_REQUEST_MAX}
        </span>
        <Button
          variant="outline"
          className="px-3 py-1 text-xs"
          disabled={!dirty}
          loading={saving}
          onClick={() => {
            onSave(value.trim());
            setJustSaved(true);
          }}
        >
          희망사항 저장
        </Button>
      </div>
      {error && <p className="text-xs font-medium text-brand">{error}</p>}
    </div>
  );
}
