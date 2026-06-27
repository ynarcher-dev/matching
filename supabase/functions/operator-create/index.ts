// =============================================================================
// operator-create — 운영자 계정 생성 (부가기능 슬라이스 C)
// 출처: docs/page_admin_operator_permissions.md 4.3
// =============================================================================
// 흐름:
//   1) 최고관리자 JWT 검증.
//   2) Supabase Auth 사용자 생성(임시 비밀번호 또는 초대 메일).
//   3) admin_create_operator RPC 로 public.users 행 + 감사 로그 원자 생성.
//   4) DB 실패 시 생성한 Auth 사용자를 삭제(보상).
// 시크릿: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY.
// =============================================================================
import { corsHeaders, json } from '../_shared/cors.ts';
import { admin, authorizeSuperAdmin } from '../_shared/operatorAuth.ts';

function randomPassword(): string {
  // 임시 비밀번호(초대 메일 미사용 시). 12자 영숫자+기호.
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

  let email = '', name = '', role = '', reason = '', isSuper = false, sendInvite = false;
  try {
    const b = await req.json();
    email = String(b.email ?? '').trim().toLowerCase();
    name = String(b.name ?? '').trim();
    role = String(b.role ?? '').trim();
    reason = String(b.reason ?? '').trim();
    isSuper = b.is_super_admin === true;
    sendInvite = b.send_invite === true;
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  if (!email || !name || !reason) return json({ error: 'missing_fields' }, 400);
  if (role !== 'ADMIN' && role !== 'STAFF') return json({ error: 'invalid_role' }, 400);

  // 2) Auth 사용자 생성.
  const tempPassword = sendInvite ? undefined : randomPassword();
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { name, operator_role: role },
  });
  if (createErr || !created.user) {
    const msg = createErr?.message ?? 'auth_create_failed';
    const status = /already.*registered|exists/i.test(msg) ? 409 : 400;
    return json({ error: 'auth_create_failed', detail: msg }, status);
  }
  const authUserId = created.user.id;

  // 3) public.users 행 + 감사 로그.
  const { data: newId, error: rpcErr } = await admin.rpc('admin_create_operator', {
    p_actor: actorId,
    p_auth_user_id: authUserId,
    p_email: email,
    p_name: name,
    p_role: role,
    p_is_super: isSuper,
    p_reason: reason,
  });
  if (rpcErr) {
    // 4) 보상: Auth 사용자 삭제.
    await admin.auth.admin.deleteUser(authUserId).catch(() => {});
    return json({ error: 'db_create_failed', detail: rpcErr.message }, 400);
  }

  // 초대 메일 모드: 비밀번호 설정용 recovery 링크 생성.
  let inviteLink: string | undefined;
  if (sendInvite) {
    const { data: link } = await admin.auth.admin.generateLink({ type: 'recovery', email });
    inviteLink = link?.properties?.action_link;
  }

  return json({ ok: true, id: newId, temp_password: tempPassword, invite_link: inviteLink });
});
