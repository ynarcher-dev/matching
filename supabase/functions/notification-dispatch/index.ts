// =============================================================================
// notification-dispatch — 알림 발송 워커 (Phase 7 슬라이스 1·3)
// 출처: docs/security_transactions.md 4장, docs/db_schema.md 2.15,
//       docs/page_admin_notification_settings.md §5(발송 동작·fallback)
// =============================================================================
// 흐름:
//   1) claim_due_notifications RPC 로 발송 대상(PENDING & 재시도 도래) 을 가져온다.
//   2) 전역 notification_settings(provider/dispatch_enabled) 와 행사별 정책을 읽어
//      채널·공급사 어댑터를 선택한다(설정 불완전 시 Mock 안전 폴백).
//   3) 성공 → mark_notification_sent, 실패 → mark_notification_failed(지수 백오프/3회 종료)
//
// 안전장치:
//   - 전역 dispatch_enabled = false 면 외부 발송을 시도하지 않는다(큐가 비어 있는 게 정상이나,
//     수동 적재 등 예외 상황 대비 워커에서도 한 번 더 차단한다).
//
// 시크릿/주입: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (자동 주입).
//   NOTIF_DISPATCH_SECRET(선택): Cron 호출 검증용.
//   NOTIF_BATCH_LIMIT(선택): 1회 처리 건수(기본 50).
//   SOLAPI_API_KEY / SOLAPI_API_SECRET / SOLAPI_SENDER_PHONE / SOLAPI_PF_ID: 실발송 시.
// =============================================================================
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';
import {
  notifierFor,
  resolveProviderConfig,
  type NotifyChannel,
  type ProviderConfig,
} from '../_shared/notifier.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const DISPATCH_SECRET = Deno.env.get('NOTIF_DISPATCH_SECRET') ?? '';
const BATCH_LIMIT = Number(Deno.env.get('NOTIF_BATCH_LIMIT') ?? '50');

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

interface DueNotification {
  id: string;
  event_id: string | null;
  channel: NotifyChannel;
  destination: string;
  content: string;
  notification_type: string;
}

/** 호출자 식별용(로깅). 프록시 헤더 우선, 없으면 unknown. */
function callerInfo(req: Request): { ip: string; ua: string } {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    req.headers.get('x-real-ip') ||
    'unknown';
  const ua = req.headers.get('user-agent') ?? 'unknown';
  return { ip, ua };
}

/**
 * 호출 인가(fail-closed):
 *  - 시크릿 미설정 → 503(설정 오류로 간주하고 거부. 무인증 통과 금지).
 *  - 시크릿 설정·헤더 불일치 → 401.
 *  - 일치 → 통과.
 */
function authorize(req: Request): { ok: true } | { ok: false; status: 503 | 401; reason: string } {
  if (!DISPATCH_SECRET) return { ok: false, status: 503, reason: 'secret_not_configured' };
  if (req.headers.get('x-dispatch-secret') !== DISPATCH_SECRET) {
    return { ok: false, status: 401, reason: 'secret_mismatch' };
  }
  return { ok: true };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const caller = callerInfo(req);
  const auth = authorize(req);
  if (!auth.ok) {
    console.warn(`[notification-dispatch] denied (${auth.reason}) ip=${caller.ip} ua="${caller.ua}"`);
    const body =
      auth.status === 503
        ? { error: 'service_unavailable', detail: 'dispatch secret not configured' }
        : { error: 'unauthorized' };
    return json(body, auth.status);
  }

  // 전역 설정 로드(공급사/발송 활성화).
  const { data: settings } = await admin
    .from('notification_settings')
    .select('provider, dispatch_enabled')
    .eq('id', 1)
    .single();

  const provider = (settings?.provider as 'MOCK' | 'SOLAPI' | undefined) ?? 'MOCK';
  const dispatchEnabled = Boolean(settings?.dispatch_enabled);

  // 전역 OFF: 외부 발송 시도하지 않음(큐를 건드리지 않고 빈 결과 반환).
  if (!dispatchEnabled) {
    return json({ ok: true, skipped: 'global_disabled', claimed: 0, sent: 0, failed: 0 });
  }

  const cfg: ProviderConfig = resolveProviderConfig(provider);

  const { data, error } = await admin.rpc('claim_due_notifications', { p_limit: BATCH_LIMIT });
  if (error) return json({ error: 'claim_failed', detail: error.message }, 500);

  const due = (data as DueNotification[] | null) ?? [];

  // 배치 내 행사별 정책 맵(fallback 판단용).
  const eventIds = [...new Set(due.map((n) => n.event_id).filter(Boolean) as string[])];
  const policyByEvent = new Map<string, string>();
  if (eventIds.length > 0) {
    const { data: policies } = await admin
      .from('event_notification_settings')
      .select('event_id, notification_policy')
      .in('event_id', eventIds);
    for (const p of policies ?? []) {
      policyByEvent.set(p.event_id as string, p.notification_policy as string);
    }
  }

  let sent = 0;
  let failed = 0;

  for (const n of due) {
    const policy = n.event_id ? policyByEvent.get(n.event_id) : undefined;
    const notifier = notifierFor(cfg, n.channel, policy);
    try {
      const result = await notifier.send({
        channel: n.channel,
        destination: n.destination,
        body: n.content,
        kind: n.notification_type,
      });
      if (result.ok) {
        await admin.rpc('mark_notification_sent', { p_id: n.id });
        sent += 1;
      } else {
        await admin.rpc('mark_notification_failed', { p_id: n.id, p_error: 'adapter returned not-ok' });
        failed += 1;
      }
    } catch (e) {
      await admin.rpc('mark_notification_failed', {
        p_id: n.id,
        p_error: e instanceof Error ? e.message : String(e),
      });
      failed += 1;
    }
  }

  console.log(
    `[notification-dispatch] ip=${caller.ip} provider=${provider} claimed=${due.length} sent=${sent} failed=${failed}`,
  );
  return json({ ok: true, provider, claimed: due.length, sent, failed });
});
