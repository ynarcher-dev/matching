// =============================================================================
// notification-test — 관리자 테스트 발송 (Phase 7 슬라이스 3)
// 출처: docs/page_admin_notification_settings.md §3.1(테스트 발송 버튼·결과 기록)
// =============================================================================
// 흐름:
//   1) 관리자 Supabase Auth JWT 검증 → users.role = ADMIN 확인.
//   2) { destination } 수신(관리자 본인 휴대전화 등).
//   3) 전역 provider 설정으로 어댑터 선택(설정 불완전 시 Mock).
//      ⚠ 전역 dispatch_enabled 와 무관하게 동작한다 — 토글 ON 전에 설정을 검증하기 위함(§3.1).
//      단, provider=SOLAPI 인데 키 미설정이면 외부 호출 없이 NOT_CONFIGURED 로 실패 반환.
//   4) record_notification_test RPC 로 결과 기록 후 응답.
//
// 시크릿/주입: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY,
//   SOLAPI_*(실발송 시).
// =============================================================================
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';
import {
  notifierFor,
  resolveProviderConfig,
  isSmsConfigured,
  type ProviderConfig,
} from '../_shared/notifier.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** 호출자가 ADMIN 운영진인지 확인하고 users.id 를 반환한다(아니면 null). */
async function authorizeAdmin(req: Request): Promise<string | null> {
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader) return null;

  const scoped = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error } = await scoped.auth.getUser();
  if (error || !userData.user) return null;

  const { data: profile } = await admin
    .from('users')
    .select('id, role')
    .eq('auth_user_id', userData.user.id)
    .is('deleted_at', null)
    .single();
  if (!profile || profile.role !== 'ADMIN') return null;
  return profile.id as string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const actorId = await authorizeAdmin(req);
  if (!actorId) return json({ error: 'forbidden' }, 403);

  let destination: string;
  try {
    const body = await req.json();
    destination = String(body.destination ?? '').trim();
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  if (!destination) return json({ error: 'destination_required' }, 400);

  // 전역 공급사 설정 로드.
  const { data: settings } = await admin
    .from('notification_settings')
    .select('provider')
    .eq('id', 1)
    .single();
  const provider = (settings?.provider as 'MOCK' | 'SOLAPI' | undefined) ?? 'MOCK';
  const cfg: ProviderConfig = resolveProviderConfig(provider);

  // provider=SOLAPI 인데 키 미설정 → 외부 호출 없이 실패 반환.
  if (provider === 'SOLAPI' && !isSmsConfigured(cfg)) {
    await admin.rpc('record_notification_test', { p_status: 'FAILED', p_actor: actorId });
    return json({ ok: false, reason: 'PROVIDER_NOT_CONFIGURED' }, 200);
  }

  // 테스트 메시지(휴대전화 → SMS 채널). Mock 모드면 실제 발송 없이 로그만.
  const notifier = notifierFor(cfg, 'SMS');
  let ok = false;
  try {
    const result = await notifier.send({
      channel: 'SMS',
      destination,
      body: '[YNA 비즈니스 매칭] 알림 설정 테스트 발송입니다.',
      kind: 'TEST',
    });
    ok = result.ok;
  } catch (e) {
    console.error('[notification-test] send error', e instanceof Error ? e.message : e);
    ok = false;
  }

  await admin.rpc('record_notification_test', {
    p_status: ok ? 'SUCCESS' : 'FAILED',
    p_actor: actorId,
  });

  return json({ ok, provider });
});
