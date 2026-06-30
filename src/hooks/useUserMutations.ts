import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { normalizePhone } from '@/schemas/authSchemas';
import { userKeys } from '@/hooks/useUsers';
import { proposalHistoryKeys } from '@/hooks/useProposalHistory';
import { eventDetailKeys } from '@/hooks/useEventDetail';
import {
  FILE_COLUMN,
  removeParticipantFile,
  uploadParticipantFile,
} from '@/lib/storage';
import type { ParticipantFormValues } from '@/schemas/userSchemas';
import type { ParticipantInsert } from '@/lib/userCsv';
import type { ParticipantRole } from '@/types/user';

/** 빈 문자열 → null(저장 정규화). */
const orNull = (v: string | undefined | null): string | null => {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
};

/** 폼 값 → users 테이블 컬럼. 휴대전화는 숫자만 저장한다. */
function toUserColumns(values: ParticipantFormValues) {
  return {
    role: values.role,
    name: values.name.trim(),
    email: values.email.trim(),
    phone_number: values.phone_number ? normalizePhone(values.phone_number) : null,
    company_name: orNull(values.company_name),
    representative_name: orNull(values.representative_name),
    contact_name: orNull(values.contact_name),
    company_homepage: orNull(values.company_homepage),
    company_description: orNull(values.company_description),
    expert_organization: orNull(values.expert_organization),
    expert_position: orNull(values.expert_position),
    expert_description: orNull(values.expert_description),
  };
}

/**
 * 관리자 대행 소개서 변경 1건을 이력 타임라인에 적재한다(스타트업 전용, 0052).
 * 업로드 주체(uploaded_by)는 stamp_proposal_upload 트리거가 current_app_user_id() 로 기록한다.
 */
async function recordProposalHistory(
  userId: string,
  action: 'UPLOAD' | 'REPLACE' | 'CLEAR',
  filePath: string | null,
  file: File | null,
): Promise<void> {
  const { error } = await supabase.from('proposal_uploads').insert({
    user_id: userId,
    action,
    file_path: filePath,
    file_name: file?.name ?? null,
    file_size: file?.size ?? null,
  });
  if (error) throw new Error(`소개서 이력 기록에 실패했습니다: ${error.message}`);
}

/** 사용자 기본 분야(user_fields)를 선택분으로 교체한다(전체 삭제 후 INSERT). */
async function replaceUserFields(userId: string, fieldIds: string[]): Promise<void> {
  const { error: delErr } = await supabase.from('user_fields').delete().eq('user_id', userId);
  if (delErr) throw new Error(`분야 갱신에 실패했습니다: ${delErr.message}`);
  if (fieldIds.length === 0) return;
  const rows = fieldIds.map((field_id) => ({ user_id: userId, field_id }));
  const { error: insErr } = await supabase.from('user_fields').insert(rows);
  if (insErr) throw new Error(`분야 갱신에 실패했습니다: ${insErr.message}`);
}

export interface SaveParticipantInput {
  /** 지정 시 수정, 미지정 시 신규 등록. */
  id?: string;
  values: ParticipantFormValues;
  /** 새로 업로드할 파일(역할별 버킷). 없으면 파일 변경 없음. */
  file?: File | null;
  /** 기존 파일을 제거(첨부 해제)할지 여부. */
  removeFile?: boolean;
  /** 현재 저장된 파일 객체 경로(교체/삭제 시 이전 파일 정리에 사용). */
  currentFilePath?: string | null;
}

/**
 * 참가자 개별 등록/수정 (page_admin_user_management.md §1.2, §2.4).
 * 스칼라 컬럼(users RLS 직접) → 기본 분야(user_fields 교체) → Storage 파일 순서로 처리한다.
 * 신규는 INSERT 후 반환 id 로 분야·파일을 연결한다. 이메일 중복은 부분 유니크 인덱스가 차단한다.
 */
export function useSaveParticipant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, values, file, removeFile, currentFilePath }: SaveParticipantInput) => {
      const role = values.role as ParticipantRole;

      // 1) 스칼라 컬럼 upsert → 대상 user id 확보.
      let userId = id;
      if (id) {
        const { error } = await supabase.from('users').update(toUserColumns(values)).eq('id', id);
        if (error) throw mapUserWriteError(error);
      } else {
        const { data, error } = await supabase
          .from('users')
          .insert(toUserColumns(values))
          .select('id')
          .single();
        if (error) throw mapUserWriteError(error);
        userId = (data as { id: string }).id;
      }
      if (!userId) throw new Error('대상 사용자 식별에 실패했습니다.');

      // 2) 기본 분야 교체.
      await replaceUserFields(userId, values.field_ids ?? []);

      // 3) Storage 파일(역할별 컬럼). 업로드/교체/삭제.
      //    스타트업 소개서는 과거본을 보존(삭제 금지)하고 변경 이력을 타임라인에 적재한다(0052).
      const column = FILE_COLUMN[role];
      if (file) {
        const newPath = await uploadParticipantFile(role, userId, file);
        const { error } = await supabase
          .from('users')
          .update({ [column]: newPath })
          .eq('id', userId);
        if (error) throw new Error(error.message);
        if (role === 'STARTUP') {
          await recordProposalHistory(userId, currentFilePath ? 'REPLACE' : 'UPLOAD', newPath, file);
        } else if (currentFilePath && currentFilePath !== newPath) {
          await removeParticipantFile(currentFilePath).catch(() => undefined);
        }
      } else if (removeFile && currentFilePath) {
        const { error } = await supabase
          .from('users')
          .update({ [column]: null })
          .eq('id', userId);
        if (error) throw new Error(error.message);
        if (role === 'STARTUP') {
          await recordProposalHistory(userId, 'CLEAR', null, null);
        } else {
          await removeParticipantFile(currentFilePath).catch(() => undefined);
        }
      }

      return userId;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: userKeys.all });
      qc.invalidateQueries({ queryKey: proposalHistoryKeys.all });
      qc.invalidateQueries({ queryKey: eventDetailKeys.assignable });
    },
  });
}

export interface SetParticipantFileInput {
  userId: string;
  role: ParticipantRole;
  /** 새로 업로드할 파일(역할별 버킷). */
  file: File;
  /** 현재 저장된 파일 객체 경로(교체 시 이전 파일 정리에 사용). */
  currentFilePath?: string | null;
}

/**
 * 참가자 첨부 파일만 단독 업로드/교체 — 목록에서 관리자 대행 인라인 업로드(미업로드 즉시 올리기).
 * Storage 업로드 → 역할별 컬럼 갱신, 경로가 바뀌면 이전 파일 정리.
 * 업로드 주체/시각은 0046 트리거가 current_app_user_id() 로 자동 기록한다(관리자 대행).
 */
export function useSetParticipantFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, role, file, currentFilePath }: SetParticipantFileInput) => {
      const column = FILE_COLUMN[role];
      const newPath = await uploadParticipantFile(role, userId, file);
      const { error } = await supabase
        .from('users')
        .update({ [column]: newPath })
        .eq('id', userId);
      if (error) throw new Error(error.message);
      if (role === 'STARTUP') {
        // 과거본 보존 + 타임라인 이력 적재(삭제 금지).
        await recordProposalHistory(userId, currentFilePath ? 'REPLACE' : 'UPLOAD', newPath, file);
      } else if (currentFilePath && currentFilePath !== newPath) {
        await removeParticipantFile(currentFilePath).catch(() => undefined);
      }
      return newPath;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: userKeys.all });
      qc.invalidateQueries({ queryKey: proposalHistoryKeys.all });
      // 참가자 지정 표(참가 스타트업 지정)의 IR/소개서 인라인 업로드도 즉시 반영.
      qc.invalidateQueries({ queryKey: eventDetailKeys.assignable });
    },
  });
}

/** 참가자 삭제 — 물리 삭제가 아닌 소프트 삭제(deleted_at). */
export function useSoftDeleteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('users')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: userKeys.all });
      qc.invalidateQueries({ queryKey: eventDetailKeys.assignable });
    },
  });
}

/**
 * CSV 일괄 등록 — 검증을 통과한 행만 한 번에 INSERT.
 * 호출부(CsvBulkUploader)가 오류가 0건일 때만 호출한다(§2.2 오류 제어).
 */
export function useBulkCreateUsers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (rows: ParticipantInsert[]) => {
      if (rows.length === 0) return 0;
      const { error } = await supabase.from('users').insert(rows);
      if (error) throw mapUserWriteError(error);
      return rows.length;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: userKeys.all });
      qc.invalidateQueries({ queryKey: eventDetailKeys.assignable });
    },
  });
}

/** 세션 무효화 — session_version 증가 RPC(사유 필수, 감사 로그). */
export function useInvalidateSessions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const { error } = await supabase.rpc('admin_invalidate_user_sessions', {
        p_user_id: id,
        p_reason: reason.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: userKeys.all });
      qc.invalidateQueries({ queryKey: eventDetailKeys.assignable });
    },
  });
}

export interface EmergencyTokenResult {
  token: string;
  expires_at: string;
}

/**
 * 1회용 로그인 링크 발급 — issue_emergency_login_token RPC.
 * 평문 토큰을 1회 반환받아 링크를 구성한다(서버는 해시만 저장).
 */
export function useIssueEmergencyToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const { data, error } = await supabase.rpc('issue_emergency_login_token', {
        p_user_id: id,
        p_reason: reason.trim(),
      });
      if (error) throw error;
      return data as EmergencyTokenResult | null;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: userKeys.all }),
  });
}

/** 쓰기 오류를 사용자 메시지로 변환(이메일 중복 유니크 위반 등). */
function mapUserWriteError(error: { code?: string; message: string }): Error {
  if (error.code === '23505') {
    return new Error('이미 등록된 이메일입니다.');
  }
  return new Error(error.message);
}
