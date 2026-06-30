import { Badge } from '@/components/common/Badge';
import { Button } from '@/components/common/Button';
import { SelectField } from '@/components/common/SelectField';
import { formatDateTime } from '@/lib/datetime';
import { scorePercent } from '@/lib/allocation';
import { BOOKING_TYPE_LABELS } from '@/lib/labels';
import type { MatchingSlotRow } from '@/types/eventDetail';
import type { MatchingProposalRow } from '@/types/aiAllocation';

interface ProposalSlotCardProps {
  slot: MatchingSlotRow;
  /** 이 슬롯을 대상으로 하는 AI 제안(없으면 빈 슬롯 또는 기존 예약). */
  proposal: MatchingProposalRow | null;
  /** 이미 확정 예약된 슬롯의 스타트업 호칭(없으면 null). */
  bookedLabel: string | null;
  /** 제안 대상 스타트업 호칭. */
  proposalLabel: string | null;
  /** 확정 시 충돌 예상(붉은 보더). */
  conflict: boolean;
  /** 이동 가능한 빈 슬롯 선택지(전문가·시각). */
  moveOptions: { value: string; label: string }[];
  timezone: string;
  busy: boolean;
  onToggleLock: (id: string, next: boolean) => void;
  onMove: (id: string, slotId: string) => void;
}

/**
 * 시간표 한 슬롯 카드 (page_admin_ai_allocation.md §2.1 컬러 코드).
 * 수동/강제 확정=민트, AI 제안=연보라+라벨, 충돌=붉은 보더, 분야 불일치=경고.
 */
export function ProposalSlotCard({
  slot,
  proposal,
  bookedLabel,
  proposalLabel,
  conflict,
  moveOptions,
  timezone,
  busy,
  onToggleLock,
  onMove,
}: ProposalSlotCardProps) {
  const time = formatDateTime(slot.start_time, timezone).slice(-5);

  // 1) 이미 확정된 예약(수동/AI/강제) — success(민트).
  if (bookedLabel) {
    return (
      <div className="rounded-lg border border-success-border bg-success-surface px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-success">{time}</span>
          <Badge tone="success" size="11">
            {BOOKING_TYPE_LABELS[slot.booking_type]}
          </Badge>
        </div>
        <p className="mt-1 text-sm font-medium text-neutral-base">{bookedLabel}</p>
      </div>
    );
  }

  // 2) AI 제안 — ai(연보라)(+ 충돌 시 danger 보더, 분야 불일치 경고).
  if (proposal) {
    return (
      <div
        className={`rounded-lg border bg-ai-surface px-3 py-2 ${
          conflict ? 'border-danger ring-1 ring-danger-border' : 'border-ai-border'
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-ai">{time}</span>
          <Badge tone="ai" size="11">
            AI 제안 · 적합도 {scorePercent(proposal.score)}%
          </Badge>
        </div>
        <p className="mt-1 text-sm font-medium text-neutral-base">{proposalLabel}</p>

        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {!proposal.field_matched && (
            <Badge tone="warning" size="11">
              ⚠ 분야 불일치
            </Badge>
          )}
          {conflict && (
            <Badge tone="danger" size="11">
              충돌 우려
            </Badge>
          )}
          {proposal.is_locked && (
            <Badge tone="muted" size="11">
              🔒 고정
            </Badge>
          )}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => onToggleLock(proposal.id, !proposal.is_locked)}
          >
            {proposal.is_locked ? '고정 해제' : '고정'}
          </Button>
          {moveOptions.length > 0 && (
            <div className="min-w-[180px] flex-1">
              <SelectField
                label=""
                aria-label="다른 빈 슬롯으로 이동"
                disabled={busy}
                value=""
                onChange={(e) => {
                  if (e.target.value) onMove(proposal.id, e.target.value);
                }}
                options={[{ value: '', label: '다른 빈 슬롯으로 이동…' }, ...moveOptions]}
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  // 3) 빈 슬롯.
  return (
    <div className="rounded-lg border border-dashed border-border bg-white px-3 py-2">
      <span className="text-xs font-semibold text-neutral-base/50">{time}</span>
      <p className="mt-1 text-sm text-neutral-base/40">빈 슬롯</p>
    </div>
  );
}
