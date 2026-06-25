// =============================================================================
// participant-otp-request — 전문가/스타트업 OTP 요청(등록 이메일/휴대전화)
// 출처: docs/page_auth_layout.md §1.3~1.4, docs/security_transactions.md 1장
// =============================================================================
// 흐름:
//   1) { identifier } 수신 (등록 이메일 또는 휴대전화)
//   2) service_role 로 request_participant_otp RPC 호출
//      → 매칭·레이트리밋·이전 OTP 무효화·신규 발급을 한 트랜잭션에서 처리하고
//        SENT 인 경우에만 평문 OTP 를 발송용으로 반환(DB 미저장)
//   3) status==SENT 면 Mock 어댑터로 발송. 그 외(THROTTLED/SKIP)는 발송하지 않음.
//   4) 계정 열거 방지: 존재/매칭 여부와 무관하게 항상 generic 200 { ok, retry_after }
//
// 시크릿/주입: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (자동 주입).
//   OTP_IP_SALT(선택): 요청 IP 해시용 솔트(레이트리밋/감사 비식별).
// 레이트리밋: 운영 시 Edge 앞단(WAF/게이트웨이) 또는 IP 기준 추가 제한 권장.
// =============================================================================
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';
import { getNotifier, otpMessageBody, type NotifyChannel } from '../_shared/notifier.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const DEFAULT_RETRY_AFTER = 60;

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

  let identifier: string;
  try {
    const body = await req.json();
    identifier = String(body.identifier ?? '').trim();
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  // 빈 입력도 generic 처리(존재 여부 비노출).
  if (!identifier) return json({ ok: true, retry_after: DEFAULT_RETRY_AFTER });

  const ipHash = await hashIp(req);

  const { data: result, error } = await admin.rpc('request_participant_otp', {
    p_identifier: identifier,
    p_ip_hash: ipHash,
  });
  // 서버 오류만 5xx(클라이언트는 네트워크 안내). 그 외에는 항상 generic 성공.
  if (error) return json({ error: 'server_error' }, 500);

  const retryAfter = (result?.retry_after as number | undefined) ?? DEFAULT_RETRY_AFTER;

  if (result?.status === 'SENT' && result.otp) {
    try {
      await getNotifier().send({
        channel: result.channel as NotifyChannel,
        destination: String(result.destination),
        body: otpMessageBody(String(result.otp)),
        kind: 'PARTICIPANT_LOGIN_OTP',
      });
    } catch {
      // 발송 실패도 계정 열거 방지를 위해 generic 응답을 유지한다(감사는 어댑터/로그).
    }
  }

  return json({ ok: true, retry_after: retryAfter });
});
