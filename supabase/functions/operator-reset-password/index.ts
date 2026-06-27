// =============================================================================
// operator-reset-password — 운영자 비밀번호 재설정/초대 링크 (부가기능 슬라이스 C)
// 출처: docs/page_admin_operator_permissions.md 4.3
// =============================================================================
// mode='temp_password': 임시 비밀번호를 즉시 설정해 1회 반환.
// mode='invite'       : 비밀번호 설정용 recovery 링크 생성.
// 두 경우 모두 record_operator_audit RPC 로 감사 로그를 남긴다.
// =============================================================================
import { corsHeaders, json } from '../_shared/cors.ts';
import { admin, authorizeSuperAdmin } from '../_shared/operatorAuth.ts';

function randomPassword(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';
  const buf = new Uint32Array(16);
  crypto.getRandomValues(buf);
  return Array.from(buf, (n) => chars[n % chars.length]).join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const actorId = await authorizeSuperAdmin(req);
  if (!actorId) return json({ error: 'forbidden' }, 403);

  let userId = '', mode = 'temp_password', reason = '';
  try {
    const b = await req.json();
    userId = String(b.user_id ?? '').trim();
    mode = String(b.mode ?? 'temp_password').trim();
    reason = String(b.reason ?? '').trim();
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  if (!userId || !reason) return json({ error: 'missing_fields' }, 400);

  const { data: target } = await admin
    .from('users')
    .select('auth_user_id, email, role')
    .eq('id', userId)
    .is('deleted_at', null)
    .single();
  if (!target || (target.role !== 'ADMIN' && target.role !== 'STAFF') || !target.auth_user_id) {
    return json({ error: 'operator_not_found' }, 404);
  }

  let tempPassword: string | undefined;
  let inviteLink: string | undefined;
  if (mode === 'invite') {
    const { data: link, error } = await admin.auth.admin.generateLink({
      type: 'recovery',
      email: target.email as string,
    });
    if (error) return json({ error: 'link_failed', detail: error.message }, 400);
    inviteLink = link?.properties?.action_link;
  } else {
    tempPassword = randomPassword();
    const { error } = await admin.auth.admin.updateUserById(target.auth_user_id as string, {
      password: tempPassword,
    });
    if (error) return json({ error: 'reset_failed', detail: error.message }, 400);
  }

  await admin.rpc('record_operator_audit', {
    p_actor: actorId,
    p_action: 'RESET_OPERATOR_PASSWORD',
    p_target_id: userId,
    p_reason: reason,
  });

  return json({ ok: true, temp_password: tempPassword, invite_link: inviteLink });
});
