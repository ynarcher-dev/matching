import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import type { ProposalUpload } from '@/types/user';

/**
 * 스타트업 소개서 업로드 이력(타임라인, 0052 proposal_uploads).
 * 관리자 화면 전용 조회 — 업로드 주체 이름은 uploaded_by FK 임베드로 함께 가져온다.
 */
export const proposalHistoryKeys = {
  all: ['proposal-uploads'] as const,
  byUser: (userId: string) => ['proposal-uploads', userId] as const,
};

/** proposal_uploads 한 행 + 업로더 임베드(원시 응답). */
interface ProposalUploadRow {
  id: string;
  user_id: string;
  action: ProposalUpload['action'];
  file_path: string | null;
  file_name: string | null;
  file_size: number | null;
  uploaded_at: string;
  uploaded_by: string | null;
  uploader: { name: string } | null;
}

/**
 * 특정 스타트업의 소개서 변경 이력(최신순). userId 가 없으면 비활성.
 * uploaded_by → users(name) 임베드로 주체 이름을 해석한다(관리자 RLS 전체 SELECT).
 */
export function useProposalHistory(userId: string | undefined, enabled = true) {
  return useQuery<ProposalUpload[]>({
    queryKey: proposalHistoryKeys.byUser(userId ?? ''),
    enabled: Boolean(userId) && enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('proposal_uploads')
        .select(
          'id,user_id,action,file_path,file_name,file_size,uploaded_at,uploaded_by,uploader:uploaded_by(name)',
        )
        .eq('user_id', userId as string)
        .order('uploaded_at', { ascending: false })
        .returns<ProposalUploadRow[]>();
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id,
        user_id: r.user_id,
        action: r.action,
        file_path: r.file_path,
        file_name: r.file_name,
        file_size: r.file_size,
        uploaded_at: r.uploaded_at,
        uploaded_by: r.uploaded_by,
        uploader_name: r.uploader?.name ?? null,
      }));
    },
  });
}
