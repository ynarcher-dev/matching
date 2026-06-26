import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { eventDetailKeys } from '@/hooks/useEventDetail';
import type {
  ConfirmResult,
  GenerateSummary,
  MatchingProposalRow,
} from '@/types/aiAllocation';

/**
 * AI 자동배치 제안 조회/생성/확정 (page_admin_ai_allocation.md).
 * 조회·잠금·이동은 matching_proposals RLS(관리자) 직접, 생성·확정은 RPC 경유.
 * rpc 호출에는 .returns<>() 를 쓰지 않고 as 캐스트로 받는다(supabase 타입 충돌 회피).
 */

export const aiAllocationKeys = {
  proposals: (eventId: string) => ['ai-proposals', eventId] as const,
};

/** 행사 제안 목록(배정/미배치 모두). 점수 내림차순. */
export function useEventProposals(eventId: string) {
  return useQuery<MatchingProposalRow[]>({
    queryKey: aiAllocationKeys.proposals(eventId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('matching_proposals')
        .select(
          'id,event_id,target_slot_id,startup_id,score,field_matched,unmatched_reason,is_locked',
        )
        .eq('event_id', eventId)
        .order('score', { ascending: false })
        .returns<MatchingProposalRow[]>();
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** AI 제안 생성(재계산) — generate_ai_proposals RPC. 잠금 제안은 보존. */
export function useGenerateProposals(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('generate_ai_proposals', {
        p_event_id: eventId,
      });
      if (error) throw error;
      return data as unknown as GenerateSummary;
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: aiAllocationKeys.proposals(eventId) }),
  });
}

/** 제안 확정(부분 확정) — confirm_ai_proposals RPC. ids=undefined 면 전체 확정. */
export function useConfirmProposals(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (proposalIds?: string[]) => {
      const { data, error } = await supabase.rpc('confirm_ai_proposals', {
        p_event_id: eventId,
        p_proposal_ids: proposalIds ?? null,
      });
      if (error) throw error;
      return data as unknown as ConfirmResult;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: aiAllocationKeys.proposals(eventId) });
      qc.invalidateQueries({ queryKey: eventDetailKeys.slots(eventId) });
    },
  });
}

/** 제안 잠금 토글 — is_locked UPDATE(관리자 RLS). 잠근 제안은 재계산 시 보존된다. */
export function useToggleProposalLock(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, locked }: { id: string; locked: boolean }) => {
      const { error } = await supabase
        .from('matching_proposals')
        .update({ is_locked: locked, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: aiAllocationKeys.proposals(eventId) }),
  });
}

/**
 * 제안을 다른 빈 슬롯으로 이동 — target_slot_id UPDATE + 잠금(관리자 수동 변경 보존).
 * 드래그앤드롭 대신 셀렉트 변경 1차 구현(page_admin_ai_allocation.md §2.1).
 */
export function useMoveProposal(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, slotId }: { id: string; slotId: string }) => {
      const { error } = await supabase
        .from('matching_proposals')
        .update({
          target_slot_id: slotId,
          is_locked: true,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);
      if (error) throw mapMoveError(error);
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: aiAllocationKeys.proposals(eventId) }),
  });
}

/** 같은 슬롯에 이미 제안이 있으면(UNIQUE) 안내 메시지로 변환. */
function mapMoveError(error: { code?: string; message: string }): Error {
  if (error.code === '23505') {
    return new Error('이미 다른 제안이 배정된 슬롯입니다. 다른 빈 슬롯을 선택해 주세요.');
  }
  return new Error(error.message);
}
