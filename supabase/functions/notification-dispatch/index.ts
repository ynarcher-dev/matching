// =============================================================================
// notification-dispatch — 알림 발송 워커 (Phase 7 슬라이스 1)
// 출처: docs/security_transactions.md 4장, docs/db_schema.md 2.15
// =============================================================================
// 흐름:
//   1) claim_due_notifications RPC 로 발송 대상(PENDING & 재시도 도래) 을 가져온다.
//      (RPC 가 next_retry_at 을 2분 뒤로 밀어 동시 실행/크래시에 안전한 가시성 타임아웃)
//   2) 각 건을 notifier.ts 어댑터(Mock/Solapi)로 발송한다.
//   3) 성공 → mark_notification_sent, 실패 → mark_notification_failed(지수 백오프/3회 종료)
//
// 호출 경로:
//   - pg_cron(net.http_post) 가 1분 주기로 호출(0034). 헤더 x-dispatch-secret 검증.
//   - 시크릿 미설정 환경에서는 service_role 베어러로도 호출 가능(관리자/수동 트리거).
//
// 시크릿/주입: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (자동 주입).
//   NOTIF_DISPATCH_SECRET(선택): Cron 호출 검증용. 설정 시 x-dispatch-secret 헤더와 일치해야 함.
//   NOTIF_BATCH_LIMIT(선택): 1회 처리 건수(기본 50).
// =============================================================================
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';
import { getNotifier, type NotifyChannel } from '../_shared/notifier.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const DISPATCH_SECRET = Deno.env.get('NOTIF_DISPATCH_SECRET') ?? '';
const BATCH_LIMIT = Number(Deno.env.get('NOTIF_BATCH_LIMIT') ?? '50');

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

interface DueNotification {
  id: string;
  channel: NotifyChannel;
  destination: string;
  content: string;
  notification_type: string;
}

/** 호출 인가: 시크릿이 설정돼 있으면 헤더가 일치해야 한다(미설정이면 통과 — service_role 베어러 전제). */
function authorize(req: Request): boolean {
  if (!DISPATCH_SECRET) return true;
  return req.headers.get('x-dispatch-secret') === DISPATCH_SECRET;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  if (!authorize(req)) return json({ error: 'unauthorized' }, 401);

  const { data, error } = await admin.rpc('claim_due_notifications', { p_limit: BATCH_LIMIT });
  if (error) return json({ error: 'claim_failed', detail: error.message }, 500);

  const due = (data as DueNotification[] | null) ?? [];
  const notifier = getNotifier();
  let sent = 0;
  let failed = 0;

  for (const n of due) {
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

  return json({ ok: true, claimed: due.length, sent, failed });
});
