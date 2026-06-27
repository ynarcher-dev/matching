import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import type { OperatorSecretResult } from '@/types/operator';

/** Edge Function 오류에서 사람이 읽을 메시지를 추출한다. */
async function invokeOperatorFn<T>(fn: string, body: object): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T & { error?: string; detail?: string }>(
    fn,
    { body: body as Record<string, unknown> },
  );
  if (error) {
    const status = (error as { context?: { status?: number } }).context?.status;
    if (status === 403) throw new Error('권한이 없습니다(최고관리자 전용).');
    if (status === 409) throw new Error('이미 등록된 이메일입니다.');
    throw new Error(error.message);
  }
  if (data && (data as { error?: string }).error) {
    throw new Error((data as { detail?: string }).detail || (data as { error: string }).error);
  }
  return data as T;
}

export interface CreateOperatorArgs {
  email: string;
  name: string;
  role: 'ADMIN' | 'STAFF';
  is_super_admin: boolean;
  send_invite: boolean;
  reason: string;
}

export function useCreateOperator() {
  const qc = useQueryClient();
  return useMutation<OperatorSecretResult, Error, CreateOperatorArgs>({
    mutationFn: (args) => invokeOperatorFn<OperatorSecretResult>('operator-create', args),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['operators'] }),
  });
}

export interface UpdateOperatorArgs {
  user_id: string;
  name: string;
  role: 'ADMIN' | 'STAFF';
  is_super_admin: boolean;
  active: boolean;
  reason: string;
}

export function useUpdateOperator() {
  const qc = useQueryClient();
  return useMutation<{ ok: boolean }, Error, UpdateOperatorArgs>({
    mutationFn: (args) => invokeOperatorFn<{ ok: boolean }>('operator-update', args),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['operators'] }),
  });
}

export interface ResetPasswordArgs {
  user_id: string;
  mode: 'temp_password' | 'invite';
  reason: string;
}

export function useResetOperatorPassword() {
  return useMutation<OperatorSecretResult, Error, ResetPasswordArgs>({
    mutationFn: (args) => invokeOperatorFn<OperatorSecretResult>('operator-reset-password', args),
  });
}

export interface GrantEventOperatorArgs {
  event_id: string;
  user_id: string;
  permission: 'OWNER' | 'MANAGER' | 'STAFF' | 'VIEWER';
  reason: string;
}

export function useGrantEventOperator() {
  const qc = useQueryClient();
  return useMutation<{ ok: boolean; id?: string }, Error, GrantEventOperatorArgs>({
    mutationFn: (args) => invokeOperatorFn('event-operator-grant', args),
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['event-operators', vars.user_id] });
      void qc.invalidateQueries({ queryKey: ['operators'] });
    },
  });
}

export interface RevokeEventOperatorArgs {
  event_id: string;
  user_id: string;
  reason: string;
}

export function useRevokeEventOperator() {
  const qc = useQueryClient();
  return useMutation<{ ok: boolean }, Error, RevokeEventOperatorArgs>({
    mutationFn: (args) => invokeOperatorFn('event-operator-revoke', args),
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['event-operators', vars.user_id] });
      void qc.invalidateQueries({ queryKey: ['operators'] });
    },
  });
}
