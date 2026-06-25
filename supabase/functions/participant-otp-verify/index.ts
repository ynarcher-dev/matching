// =============================================================================
// participant-otp-verify — 6자리 OTP 검증 → 참가자 커스텀 JWT 발급
// 출처: docs/dev_conventions.md 5장, docs/page_auth_layout.md §1.3
// =============================================================================
// 흐름:
//   1) { identifier, code } 수신
//   2) service_role 로 verify_participant_otp RPC 호출
//      → 매칭·만료·시도횟수·1회 사용을 원자적으로 처리하고 OK/INVALID 반환
//   3) OK 면 users 프로필 조회 후 Supabase JWT 시크릿으로 커스텀 JWT 서명
//      claims: role=authenticated, app_role, participant_id, session_version
//   4) { token, user } 반환. INVALID 는 401.
//
// 시크릿(supabase secrets set; SUPABASE_ 접두사는 예약어라 사용 불가):
//   PARTICIPANT_JWT_SECRET = 프로젝트의 JWT(HS256) 시크릿 — PostgREST/GoTrue 가 검증.
// 자동 주입: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// =============================================================================
import { createClient } from 'npm:@supabase/supabase-js@2';
import { SignJWT } from 'npm:jose@5';
import { corsHeaders, json } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const JWT_SECRET = Deno.env.get('PARTICIPANT_JWT_SECRET')!;
// 세션 지속시간. 명세(page_auth_layout §1.4)는 "기본 12시간 또는 행사 종료 시각 중 빠른 시점".
// 현재는 기본 12시간만 적용한다. 행사 종료 시각 캡(min(12h, event_end))은 행사 선택
// 흐름이 생기는 Phase 4~5 에서 추가한다(참가자가 복수 행사에 속할 수 있어 기준 행사 필요).
const JWT_TTL_SECONDS = 60 * 60 * 12; // 12시간

const USER_COLUMNS =
  'id,email,name,role,company_name,representative_name,expert_position,is_super_admin';

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  let identifier: string;
  let code: string;
  try {
    const body = await req.json();
    identifier = String(body.identifier ?? '').trim();
    code = String(body.code ?? '');
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  if (!identifier || !code) return json({ error: 'bad_request' }, 400);

  // 1) OTP 검증(매칭·만료·시도횟수·1회 사용 원자 처리)
  const { data: result, error: rpcError } = await admin.rpc('verify_participant_otp', {
    p_identifier: identifier,
    p_code: code,
  });
  if (rpcError) return json({ error: 'server_error' }, 500);
  if (!result || result.status !== 'OK') {
    // 불일치/만료/소진은 4xx(클라이언트가 "새 인증번호 요청" 경로 노출)
    return json({ error: 'invalid_otp' }, 401);
  }

  // 2) 프로필 조회(헤더 표시용 필드 포함)
  const { data: profile, error: profileError } = await admin
    .from('users')
    .select(USER_COLUMNS)
    .eq('id', result.user_id)
    .single();
  if (profileError || !profile) return json({ error: 'server_error' }, 500);

  // 3) 커스텀 JWT 서명
  const secret = new TextEncoder().encode(JWT_SECRET);
  const nowSec = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({
    role: 'authenticated',
    app_role: result.role,
    participant_id: result.user_id,
    session_version: result.session_version,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(String(result.user_id))
    .setAudience('authenticated')
    .setIssuedAt(nowSec)
    .setExpirationTime(nowSec + JWT_TTL_SECONDS)
    .sign(secret);

  return json({ token, user: profile });
});
