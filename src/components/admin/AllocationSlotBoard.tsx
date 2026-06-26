import { useMemo } from 'react';
import { Card } from '@/components/common/Card';
import { ProposalSlotCard } from '@/components/admin/ProposalSlotCard';
import { formatDateTime } from '@/lib/datetime';
import { participantLabel } from '@/lib/labels';
import { proposalHasConflict } from '@/lib/allocation';
import type { AssignableUser, MatchingSlotRow } from '@/types/eventDetail';
import type { MatchingProposalRow } from '@/types/aiAllocation';

interface AllocationSlotBoardProps {
  slots: MatchingSlotRow[];
  proposals: MatchingProposalRow[];
  userById: Map<string, AssignableUser>;
  timezone: string;
  busy: boolean;
  onToggleLock: (id: string, next: boolean) => void;
  onMove: (id: string, slotId: string) => void;
}

/** 전문가 1인 트랙(전문가 + 시간순 슬롯). */
interface ExpertTrack {
  expertId: string;
  expertLabel: string;
  slots: MatchingSlotRow[];
}

/**
 * 임시 배정 시간표 (page_admin_ai_allocation.md §2.1).
 * 전문가별로 슬롯을 시간순 나열하고, 각 슬롯을 ProposalSlotCard 로 컬러 코드 렌더한다.
 */
export function AllocationSlotBoard({
  slots,
  proposals,
  userById,
  timezone,
  busy,
  onToggleLock,
  onMove,
}: AllocationSlotBoardProps) {
  const slotById = useMemo(() => new Map(slots.map((s) => [s.id, s])), [slots]);

  // 슬롯에 배정된(매칭) 제안만 슬롯 기준으로 인덱싱.
  const proposalBySlot = useMemo(() => {
    const m = new Map<string, MatchingProposalRow>();
    for (const p of proposals) {
      if (p.target_slot_id) m.set(p.target_slot_id, p);
    }
    return m;
  }, [proposals]);

  const expertLabelOf = (expertId: string) => {
    const u = userById.get(expertId);
    return u ? participantLabel(u) : '(알 수 없는 전문가)';
  };

  // 이동 후보(빈 슬롯) 선택지 — 전체 빈 슬롯을 "전문가 · 시각" 으로.
  const moveOptions = useMemo(() => {
    return slots
      .filter((s) => s.startup_id === null && s.session_status === 'WAITING')
      .filter((s) => !proposalBySlot.has(s.id))
      .map((s) => ({
        value: s.id,
        label: `${expertLabelOf(s.expert_id)} · ${formatDateTime(s.start_time, timezone).slice(-5)}`,
      }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots, proposalBySlot, userById, timezone]);

  const tracks = useMemo<ExpertTrack[]>(() => {
    const byExpert = new Map<string, MatchingSlotRow[]>();
    for (const s of slots) {
      const arr = byExpert.get(s.expert_id) ?? [];
      arr.push(s);
      byExpert.set(s.expert_id, arr);
    }
    return [...byExpert.entries()]
      .map(([expertId, list]) => ({
        expertId,
        expertLabel: expertLabelOf(expertId),
        slots: [...list].sort((a, b) => a.start_time.localeCompare(b.start_time)),
      }))
      .sort((a, b) => a.expertLabel.localeCompare(b.expertLabel, 'ko'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots, userById]);

  if (slots.length === 0) {
    return (
      <Card className="p-6">
        <p className="text-center text-sm text-neutral-base/60">
          매칭 슬롯이 없습니다. 행사 상세의 배치 탭에서 시간표 슬롯을 먼저 생성해 주세요.
        </p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Legend />
      {tracks.map((track) => (
        <Card key={track.expertId} className="flex flex-col gap-3 p-4">
          <h3 className="text-base font-bold text-neutral-base">{track.expertLabel}</h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {track.slots.map((slot) => {
              const proposal = proposalBySlot.get(slot.id) ?? null;
              const startup =
                slot.startup_id && slot.session_status !== 'CANCELLED'
                  ? userById.get(slot.startup_id)
                  : null;
              const bookedLabel = startup ? participantLabel(startup) : null;
              const proposalStartup = proposal ? userById.get(proposal.startup_id) : null;
              const proposalLabel = proposalStartup
                ? participantLabel(proposalStartup)
                : proposal
                  ? '(알 수 없는 스타트업)'
                  : null;
              const conflict = proposal
                ? proposalHasConflict(proposal, slotById, slots)
                : false;
              return (
                <ProposalSlotCard
                  key={slot.id}
                  slot={slot}
                  proposal={proposal}
                  bookedLabel={bookedLabel}
                  proposalLabel={proposalLabel}
                  conflict={conflict}
                  moveOptions={moveOptions}
                  timezone={timezone}
                  busy={busy}
                  onToggleLock={onToggleLock}
                  onMove={onMove}
                />
              );
            })}
          </div>
        </Card>
      ))}
    </div>
  );
}

/** 컬러 코드 범례. */
function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface/50 px-3 py-2 text-xs text-neutral-base/70">
      <LegendItem className="border-emerald-200 bg-emerald-50" label="기존 확정(수동/AI/강제)" />
      <LegendItem className="border-violet-200 bg-violet-50" label="AI 제안" />
      <LegendItem className="border-red-400 bg-white" label="충돌 우려" />
      <span className="inline-flex items-center gap-1">
        <span className="text-amber-600">⚠</span> 분야 불일치(차선)
      </span>
    </div>
  );
}

function LegendItem({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-3 w-3 rounded-sm border ${className}`} />
      {label}
    </span>
  );
}
