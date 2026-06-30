import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import type {
  AuthChannel,
  ParticipantRow,
  ParticipantWithAuth,
} from '@/types/user';

/** 관리자 목록·폼에서 쓰는 참가자 컬럼(민감 컬럼 제외). */
const PARTICIPANT_COLUMNS =
  'id,email,name,role,phone_number,company_name,representative_name,contact_name,' +
  'company_description,company_homepage,expert_organization,expert_position,' +
  'expert_description,proposal_file_url,proposal_uploaded_at,proposal_uploaded_by,' +
  'profile_image_url,last_login_at,session_version,created_at';

export const userKeys = {
  all: ['users'] as const,
  list: () => [...userKeys.all, 'list'] as const,
};

/** 등록 연락처 보유 여부에서 인증 가능 채널을 도출한다. */
function deriveChannels(u: ParticipantRow): AuthChannel[] {
  const channels: AuthChannel[] = [];
  if (u.email) channels.push('EMAIL');
  if (u.phone_number && u.phone_number.trim()) channels.push('SMS');
  return channels;
}

/**
 * 참가자(전문가/스타트업) 목록 + 인증 개요 + 기본 분야 조회 (page_admin_user_management.md §1.2).
 * 목록은 users RLS(관리자 전체) 로 직접 SELECT, 최근 OTP 발송 상태/긴급토큰 활성 여부는
 * 민감 테이블을 우회하는 admin_participant_auth_overview RPC 로, 분야는 user_fields(관리자 RLS)
 * 직접 SELECT 로 가져와 병합한다. 역할 탭/검색 필터는 화면에서 적용한다(참가자 규모 가정).
 */
export function useParticipants() {
  return useQuery<ParticipantWithAuth[]>({
    queryKey: userKeys.list(),
    queryFn: async () => {
      const [usersRes, fieldsRes] = await Promise.all([
        supabase
          .from('users')
          .select(PARTICIPANT_COLUMNS)
          .is('deleted_at', null)
          .in('role', ['EXPERT', 'STARTUP'])
          .order('created_at', { ascending: false })
          .returns<ParticipantRow[]>(),
        supabase.from('user_fields').select('user_id,field_id').returns<UserFieldRow[]>(),
      ]);
      if (usersRes.error) throw usersRes.error;
      if (fieldsRes.error) throw fieldsRes.error;

      const fieldsByUser = new Map<string, string[]>();
      for (const f of fieldsRes.data ?? []) {
        const list = fieldsByUser.get(f.user_id);
        if (list) list.push(f.field_id);
        else fieldsByUser.set(f.user_id, [f.field_id]);
      }

      // 소개서 업로드 주체 이름 해석(업로더는 운영자일 수 있어 참가자 집합 밖이라 별도 조회).
      const uploaderIds = [
        ...new Set(
          (usersRes.data ?? [])
            .map((u) => u.proposal_uploaded_by)
            .filter((v): v is string => Boolean(v)),
        ),
      ];
      const uploaderNameById = new Map<string, string>();
      if (uploaderIds.length > 0) {
        const { data: uploaders, error: upErr } = await supabase
          .from('users')
          .select('id,name')
          .in('id', uploaderIds)
          .returns<{ id: string; name: string }[]>();
        if (upErr) throw upErr;
        for (const up of uploaders ?? []) uploaderNameById.set(up.id, up.name);
      }

      return (usersRes.data ?? []).map((u) => ({
        ...u,
        channels: deriveChannels(u),
        field_ids: fieldsByUser.get(u.id) ?? [],
        proposal_uploader_name: u.proposal_uploaded_by
          ? (uploaderNameById.get(u.proposal_uploaded_by) ?? null)
          : null,
      }));
    },
  });
}

interface UserFieldRow {
  user_id: string;
  field_id: string;
}
