// =============================================================================
// emergency-login — 현장 예외용 1회용 로그인 링크 토큰 소비 → 참가자 커스텀 JWT 발급
// 출처: docs/page_admin_user_management.md §2.3, docs/page_auth_layout.md §1.3
// =============================================================================
// 흐름(participant-otp-verify 와 동일한 JWT 발급 경로):
//   1) { token } 수신 (관리자가 발급한 1회용 평문 토큰)
//   2) service_role 로 consume_emergency_login_token RPC 호출
//      → 해시 일치·만료·사용/회수 여부를 원자적으로 처리하고 OK/INVALID 반환
//   3) OK 면 users 프로필 조회 후 동일한 커스텀 JWT(claims 동일) 서명
//   4) { token, user } 반환. INVALID 는 401.
//
// 시크릿/주입: PARTICIPANT_JWT_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
//   OTP_IP_SALT(선택) = 요청 IP 해시용 솔트 — 설정 시 IP 기반 rate limit(동일 IP
//   10분 20회 실패 초과 → 429) 활성화. participant-login 과 동일 패턴/집계 테이블.
// =============================================================================
import { createClient } from 'npm:@supabase/supabase-js@2';
import { SignJWT } from 'npm:jose@5';
import { corsHeaders, json } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const JWT_SECRET = Deno.env.get('PARTICIPANT_JWT_SECRET')!;
// OTP 로그인과 동일한 세션 지속시간(기본 12시간).
const JWT_TTL_SECONDS = 60 * 60 * 12;

const USER_COLUMNS =
  'id,email,name,role,company_name,representative_name,expert_position,is_super_admin';

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** 요청 IP 를 비식별 해시로(원 IP 장기 저장 금지). 솔트 미설정 시 null. participant-login 과 동일. */
async function hashIp(req: Request): Promise<string | null> {
  const salt = Deno.env.get('OTP_IP_SALT');
  if (!salt) return null;
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim();
  if (!ip) return null;
  const data = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  let token: string;
  try {
    const body = await req.json();
    token = String(body.token ?? '').trim();
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  if (!token) return json({ error: 'bad_request' }, 400);

  const ipHash = await hashIp(req);

  // 1) 토큰 소비(rate limit·해시 일치·만료·1회 사용 원자 처리)
  const { data: result, error: rpcError } = await admin.rpc('consume_emergency_login_token', {
    p_token: token,
    p_ip_hash: ipHash,
  });
  if (rpcError) return json({ error: 'server_error' }, 500);
  if (result?.status === 'THROTTLED') {
    // IP 기준 시도 과다 — 토큰 존재 정보가 아니므로 429 로 안내한다.
    return json({ error: 'too_many_attempts', retry_after: result.retry_after ?? 600 }, 429);
  }
  if (!result || result.status !== 'OK') {
    // 만료/사용·회수/불일치는 401(클라이언트가 안내 후 재발급 요청 경로 노출)
    return json({ error: 'invalid_token' }, 401);
  }

  // 2) 프로필 조회(헤더 표시용 필드 포함)
  const { data: profile, error: profileError } = await admin
    .from('users')
    .select(USER_COLUMNS)
    .eq('id', result.user_id)
    .single();
  if (profileError || !profile) return json({ error: 'server_error' }, 500);

  // 3) 커스텀 JWT 서명(OTP 검증과 동일한 claims·서명 방식)
  const secret = new TextEncoder().encode(JWT_SECRET);
  const nowSec = Math.floor(Date.now() / 1000);
  const jwt = await new SignJWT({
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

  return json({ token: jwt, user: profile });
});
