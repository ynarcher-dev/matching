// =============================================================================
// event-operator-revoke — 행사별 운영자 권한 회수 (부가기능 슬라이스 C)
// 출처: docs/page_admin_operator_permissions.md 4.3
// =============================================================================
import { corsHeaders, json } from '../_shared/cors.ts';
import { admin, authorizeSuperAdmin } from '../_shared/operatorAuth.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const actorId = await authorizeSuperAdmin(req);
  if (!actorId) return json({ error: 'forbidden' }, 403);

  let eventId = '', userId = '', reason = '';
  try {
    const b = await req.json();
    eventId = String(b.event_id ?? '').trim();
    userId = String(b.user_id ?? '').trim();
    reason = String(b.reason ?? '').trim();
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  if (!eventId || !userId || !reason) return json({ error: 'missing_fields' }, 400);

  const { error } = await admin.rpc('revoke_event_operator', {
    p_actor: actorId,
    p_event_id: eventId,
    p_user_id: userId,
    p_reason: reason,
  });
  if (error) return json({ error: 'revoke_failed', detail: error.message }, 400);

  return json({ ok: true });
});
