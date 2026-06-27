// =============================================================================
// operator-update — 운영자 수정/비활성화 (부가기능 슬라이스 C)
// 출처: docs/page_admin_operator_permissions.md 4.3
// =============================================================================
// 이름/역할/최고관리자 플래그/활성 상태를 변경한다.
// 비활성화(active=false)는 public.users soft delete + Auth 사용자 ban 으로 로그인 차단.
// =============================================================================
import { corsHeaders, json } from '../_shared/cors.ts';
import { admin, authorizeSuperAdmin } from '../_shared/operatorAuth.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const actorId = await authorizeSuperAdmin(req);
  if (!actorId) return json({ error: 'forbidden' }, 403);

  let userId = '', name: string | null = null, role = '', reason = '';
  let isSuper = false, active = true;
  try {
    const b = await req.json();
    userId = String(b.user_id ?? '').trim();
    name = b.name == null ? null : String(b.name).trim();
    role = String(b.role ?? '').trim();
    reason = String(b.reason ?? '').trim();
    isSuper = b.is_super_admin === true;
    active = b.active !== false; // 기본 활성
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  if (!userId || !reason) return json({ error: 'missing_fields' }, 400);
  if (role !== 'ADMIN' && role !== 'STAFF') return json({ error: 'invalid_role' }, 400);

  // 대상 auth_user_id 조회(ban/unban 용).
  const { data: target } = await admin
    .from('users')
    .select('auth_user_id')
    .eq('id', userId)
    .single();

  const { error: rpcErr } = await admin.rpc('admin_update_operator', {
    p_actor: actorId,
    p_user_id: userId,
    p_name: name,
    p_role: role,
    p_is_super: isSuper,
    p_active: active,
    p_reason: reason,
  });
  if (rpcErr) return json({ error: 'db_update_failed', detail: rpcErr.message }, 400);

  // Auth 사용자 ban/unban 으로 로그인 차단/복구.
  if (target?.auth_user_id) {
    await admin.auth.admin
      .updateUserById(target.auth_user_id, { ban_duration: active ? 'none' : '876000h' })
      .catch(() => {});
  }

  return json({ ok: true });
});
