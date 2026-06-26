// =============================================================================
// participant-login — 이름 + 휴대전화번호 정확일치 → 참가자 커스텀 JWT 발급
// 출처: docs/free_login_transition.md, docs/page_auth_layout.md §1
// =============================================================================
// 2026-06-26 무료 운영 전환:
//   외부 발송(SMS/이메일 OTP)에 의존하지 않는 로그인. 참가자가 이름 + 휴대전화번호를
//   제출하면 등록 정보와 정확일치(공백/대소문자 정규화, 전화 숫자 정규화)하는 활성
//   참가자가 정확히 1명일 때만 JWT 를 발급한다.
//
// 흐름:
//   1) { name, phone } 수신
//   2) service_role 로 login_participant_by_name_phone RPC 호출
//      → 매칭·rate limit·시도기록을 원자적으로 처리하고 OK/INVALID/THROTTLED 반환
//   3) OK 면 users 프로필 조회 후 JWT 시크릿으로 커스텀 JWT 서명
//      claims: role=authenticated, app_role, participant_id, session_version
//   4) { token, user } 반환. INVALID 는 401, THROTTLED 는 429(둘 다 generic 본문).
//
// 시크릿(supabase secrets set; SUPABASE_ 접두사는 예약어라 사용 불가):
//   PARTICIPANT_JWT_SECRET = 프로젝트의 JWT(HS256) 시크릿 — PostgREST/GoTrue 가 검증.
//   OTP_IP_SALT(선택)      = 요청 IP 해시용 솔트(로그인 rate limit/감사 비식별).
// 자동 주입: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// =============================================================================
import { createClient } from 'npm:@supabase/supabase-js@2';
import { SignJWT } from 'npm:jose@5';
import { corsHeaders, json } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const JWT_SECRET = Deno.env.get('PARTICIPANT_JWT_SECRET')!;
// 세션 지속시간. 명세(page_auth_layout §1.4)는 "기본 12시간 또는 행사 종료 시각 중 빠른 시점".
// 현재는 기본 12시간만 적용한다(OTP verify 와 동일 정책).
const JWT_TTL_SECONDS = 60 * 60 * 12; // 12시간

const USER_COLUMNS =
  'id,email,name,role,company_name,representative_name,expert_position,is_super_admin';

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** 요청 IP 를 비식별 해시로(원 IP 장기 저장 금지). 솔트 미설정 시 null. */
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

  let name: string;
  let phone: string;
  try {
    const body = await req.json();
    name = String(body.name ?? '').trim();
    phone = String(body.phone ?? '').trim();
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  if (!name || !phone) return json({ error: 'bad_request' }, 400);

  const ipHash = await hashIp(req);

  // 1) 매칭·rate limit·시도기록(원자 처리)
  const { data: result, error: rpcError } = await admin.rpc('login_participant_by_name_phone', {
    p_name: name,
    p_phone: phone,
    p_ip_hash: ipHash,
  });
  if (rpcError) return json({ error: 'server_error' }, 500);

  if (result?.status === 'THROTTLED') {
    // IP 기준 시도 과다 — 계정 존재 정보가 아니므로 429 로 안내한다.
    return json({ error: 'too_many_attempts', retry_after: result.retry_after ?? 600 }, 429);
  }
  if (!result || result.status !== 'OK') {
    // 미등록/모호/오입력 — 계정 존재 여부를 노출하지 않는 generic 401.
    return json({ error: 'invalid_login' }, 401);
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
