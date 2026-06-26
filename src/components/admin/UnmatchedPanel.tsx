import { useMemo } from 'react';
import { Card } from '@/components/common/Card';
import { participantLabel } from '@/lib/labels';
import type { AssignableUser } from '@/types/eventDetail';
import type { MatchingProposalRow } from '@/types/aiAllocation';

interface UnmatchedPanelProps {
  proposals: MatchingProposalRow[];
  userById: Map<string, AssignableUser>;
}

/**
 * 미배치 스타트업 목록 (page_admin_ai_allocation.md §2.1).
 * target_slot_id 가 NULL 인 제안(=배정 실패)을 사유와 함께 나열한다.
 */
export function UnmatchedPanel({ proposals, userById }: UnmatchedPanelProps) {
  const unmatched = useMemo(
    () => proposals.filter((p) => p.target_slot_id === null),
    [proposals],
  );

  return (
    <Card className="flex flex-col gap-3 p-5">
      <h3 className="text-base font-bold text-neutral-base">
        미배치 스타트업 <span className="text-brand">{unmatched.length}</span>개사
      </h3>
      {unmatched.length === 0 ? (
        <p className="text-sm text-neutral-base/60">
          미배치 스타트업이 없습니다. (제안을 생성하면 배정 실패 기업이 여기에 표시됩니다.)
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
          {unmatched.map((p) => {
            const u = userById.get(p.startup_id);
            return (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5"
              >
                <span className="text-sm font-medium text-neutral-base">
                  {u ? participantLabel(u) : '(알 수 없는 스타트업)'}
                </span>
                <span className="rounded-full bg-danger-surface px-2.5 py-0.5 text-xs font-semibold text-brand">
                  {p.unmatched_reason ?? '사유 미상'}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
