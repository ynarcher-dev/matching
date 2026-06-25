import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';
import { participantClient } from '@/lib/participantClient';
import type { AuthMode } from '@/types/auth';

/**
 * 현재 인증 경로에 맞는 Supabase 클라이언트를 반환한다.
 * 데이터 훅은 `supabase`/`participantClient` 를 직접 import 하지 말고 이 헬퍼를 쓴다.
 *   - operator(ADMIN/STAFF): 내장 Auth 세션 클라이언트
 *   - participant(EXPERT/STARTUP): 커스텀 JWT 클라이언트
 */
export function clientFor(mode: AuthMode | null): SupabaseClient {
  return mode === 'participant' ? participantClient : supabase;
}
