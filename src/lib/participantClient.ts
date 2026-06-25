import { createClient } from '@supabase/supabase-js';
import { getParticipantToken } from '@/lib/participantSession';

/**
 * 참가자(EXPERT/STARTUP) 전용 Supabase 클라이언트.
 *
 * 운영진 클라이언트(`supabase`, 내장 GoTrue Auth)와 분리한다. supabase-js 는
 * `accessToken` 콜백이 지정되면 내장 Auth 세션을 사용하지 않으므로, 커스텀 JWT
 * 경로는 별도 클라이언트로 둔다. 콜백은 매 요청 현재 토큰을 반환하고, 토큰이 없으면
 * anon 키로 폴백한다(서버 RLS 가 anon 으로 처리).
 */
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';

export const participantClient = createClient(supabaseUrl, supabaseAnonKey, {
  accessToken: async () => getParticipantToken() ?? supabaseAnonKey,
});
