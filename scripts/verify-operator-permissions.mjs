/**
 * 운영자 행사별 권한 통합 검증 하니스 (슬라이스 F).
 *
 * service_role 키로 테스트 운영자 4계층(super 는 기존 라이브 계정 사용)을 생성·배정한 뒤,
 * 각 운영자로 실제 로그인(signInWithPassword)해 권한 헬퍼·RLS·RPC 가드(0042~0045)가
 * 행사 범위대로 동작하는지 단언하고, 마지막에 전부 정리(soft delete + Auth 삭제)한다.
 *
 * 실행:
 *   SUPABASE_SERVICE_ROLE_KEY=<service_role 키> node scripts/verify-operator-permissions.mjs
 *   (URL/anon 키는 .env.local 의 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 사용)
 *
 * 안전: 생성하는 계정 이메일은 `optest+<role>-<ts>@ynarcher.test` 형태(유니크)이며,
 *   종료 시 revoke→soft delete→Auth 삭제로 원복한다. 기존 데이터는 건드리지 않는다.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── .env.local 파싱 (VITE_ 값) ────────────────────────────────────────────────
function readEnvLocal() {
  const txt = readFileSync(join(__dirname, '..', '.env.local'), 'utf8');
  const out = {};
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

const env = readEnvLocal();
const URL = env.VITE_SUPABASE_URL;
const ANON = env.VITE_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !ANON) {
  console.error('✗ .env.local 에서 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 를 읽지 못했습니다.');
  process.exit(2);
}
if (!SERVICE) {
  console.error('✗ 환경변수 SUPABASE_SERVICE_ROLE_KEY 가 필요합니다.');
  console.error('  예) SUPABASE_SERVICE_ROLE_KEY=<키> node scripts/verify-operator-permissions.mjs');
  process.exit(2);
}

const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

// ── 단언 수집 ─────────────────────────────────────────────────────────────────
const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass });
  console.log(`${pass ? '  ✓' : '  ✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const TS = Date.now();
const created = []; // { authId, userId, label, password, email }

async function rpcErr(client, fn, args) {
  const { error } = await client.rpc(fn, args);
  return error ? error.message || String(error) : null;
}

async function makeOperator(label, role, permission, eventId, actorId) {
  const email = `optest+${label}-${TS}@ynarcher.test`;
  const password = `Test!${TS}${label}`;
  const { data: au, error: ae } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (ae) throw new Error(`Auth 생성 실패(${label}): ${ae.message}`);
  const authId = au.user.id;

  const { data: uid, error: ce } = await admin.rpc('admin_create_operator', {
    p_actor: actorId,
    p_auth_user_id: authId,
    p_email: email,
    p_name: `검증-${label}`,
    p_role: role,
    p_is_super: false,
    p_reason: 'F 통합 검증 시드',
  });
  if (ce) throw new Error(`admin_create_operator 실패(${label}): ${ce.message}`);

  const { error: ge } = await admin.rpc('grant_event_operator', {
    p_actor: actorId,
    p_event_id: eventId,
    p_user_id: uid,
    p_permission: permission,
    p_reason: 'F 통합 검증 배정',
  });
  if (ge) throw new Error(`grant_event_operator 실패(${label}): ${ge.message}`);

  created.push({ authId, userId: uid, label, password, email, eventId });
  return { authId, userId: uid, email, password };
}

async function signIn(email, password) {
  const c = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`로그인 실패(${email}): ${error.message}`);
  return c;
}

async function cap(client, eventId) {
  const [v, s, m] = await Promise.all([
    client.rpc('can_view_event', { p_event_id: eventId }),
    client.rpc('can_staff_event', { p_event_id: eventId }),
    client.rpc('can_manage_event', { p_event_id: eventId }),
  ]);
  return { view: v.data === true, staff: s.data === true, manage: m.data === true };
}

async function eventVisible(client, eventId) {
  const { data } = await client.from('events').select('id').eq('id', eventId);
  return (data ?? []).length > 0;
}

async function main() {
  console.log('▶ 운영자 권한 통합 검증 시작\n');

  // 0. 최고관리자 actor + 테스트 행사 2개
  const { data: supers, error: se } = await admin
    .from('users')
    .select('id,email')
    .eq('role', 'ADMIN')
    .eq('is_super_admin', true)
    .is('deleted_at', null)
    .limit(1);
  if (se) throw new Error(`super 조회 실패: ${se.message}`);
  if (!supers?.length) throw new Error('최고관리자 계정이 없습니다.');
  const actorId = supers[0].id;
  console.log(`  · actor(super) = ${supers[0].email}`);

  const { data: events, error: ee } = await admin
    .from('events')
    .select('id,title')
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(2);
  if (ee) throw new Error(`행사 조회 실패: ${ee.message}`);
  if ((events?.length ?? 0) < 2) throw new Error('테스트용 행사가 2개 이상 필요합니다(시드 0016/0031 확인).');
  const [eventA, eventB] = events;
  console.log(`  · eventA(배정) = ${eventA.title}`);
  console.log(`  · eventB(미배정 대조) = ${eventB.title}\n`);

  // 1. 시드: manager(MANAGER)·staff(STAFF)·viewer(VIEWER) 모두 eventA 에만 배정
  console.log('▶ 테스트 운영자 생성·배정');
  const mgr = await makeOperator('mgr', 'ADMIN', 'MANAGER', eventA.id, actorId);
  const stf = await makeOperator('stf', 'STAFF', 'STAFF', eventA.id, actorId);
  const vwr = await makeOperator('vwr', 'ADMIN', 'VIEWER', eventA.id, actorId);
  console.log('  ✓ 3계층 생성 완료\n');

  // 2. 권한 헬퍼 매트릭스 (로그인 후)
  console.log('▶ 권한 헬퍼 매트릭스 (can_view / can_staff / can_manage)');
  const mc = await signIn(mgr.email, mgr.password);
  const sc = await signIn(stf.email, stf.password);
  const vc = await signIn(vwr.email, vwr.password);

  const mA = await cap(mc, eventA.id), mB = await cap(mc, eventB.id);
  check('MANAGER@A view/staff/manage = T/T/T', mA.view && mA.staff && mA.manage, JSON.stringify(mA));
  check('MANAGER@B(미배정) 전부 F', !mB.view && !mB.staff && !mB.manage, JSON.stringify(mB));

  const sA = await cap(sc, eventA.id), sB = await cap(sc, eventB.id);
  check('STAFF@A view/staff/manage = T/T/F', sA.view && sA.staff && !sA.manage, JSON.stringify(sA));
  check('STAFF@B(미배정) 전부 F', !sB.view && !sB.staff && !sB.manage, JSON.stringify(sB));

  const vA = await cap(vc, eventA.id), vB = await cap(vc, eventB.id);
  check('VIEWER@A view/staff/manage = T/F/F', vA.view && !vA.staff && !vA.manage, JSON.stringify(vA));
  check('VIEWER@B(미배정) 전부 F', !vB.view && !vB.staff && !vB.manage, JSON.stringify(vB));

  // 3. events RLS 행사 격리
  console.log('\n▶ events 테이블 RLS 격리');
  check('MANAGER: 배정 행사 A 조회 가능', await eventVisible(mc, eventA.id));
  check('MANAGER: 미배정 행사 B 조회 불가', !(await eventVisible(mc, eventB.id)));
  check('STAFF: 배정 행사 A 조회 가능', await eventVisible(sc, eventA.id));
  check('STAFF: 미배정 행사 B 조회 불가', !(await eventVisible(sc, eventB.id)));
  check('VIEWER: 배정 행사 A 조회 가능', await eventVisible(vc, eventA.id));

  // 4. RPC 가드 (0043) — generate_ai_proposals 로 can_manage 경계 확인
  console.log('\n▶ RPC 가드 (generate_ai_proposals)');
  const GUARD = 'AI 자동배치는 관리자만 가능합니다.';
  const e_mgrA = await rpcErr(mc, 'generate_ai_proposals', { p_event_id: eventA.id });
  check('MANAGER@A: 권한 가드 통과(상태 오류만)', e_mgrA == null || !e_mgrA.includes(GUARD), e_mgrA ?? 'ok');
  const e_mgrB = await rpcErr(mc, 'generate_ai_proposals', { p_event_id: eventB.id });
  check('MANAGER@B(미배정): 권한 가드 차단', e_mgrB != null && e_mgrB.includes(GUARD), e_mgrB ?? '(에러 없음!)');
  const e_stfA = await rpcErr(sc, 'generate_ai_proposals', { p_event_id: eventA.id });
  check('STAFF@A: 관리 RPC 차단', e_stfA != null && e_stfA.includes(GUARD), e_stfA ?? '(에러 없음!)');
  const e_vwrA = await rpcErr(vc, 'generate_ai_proposals', { p_event_id: eventA.id });
  check('VIEWER@A: 관리 RPC 차단', e_vwrA != null && e_vwrA.includes(GUARD), e_vwrA ?? '(에러 없음!)');

  // 5. 권한 상승 차단 — 운영자가 service_role 전용 RPC 호출
  console.log('\n▶ 권한 상승 차단');
  const esc = await rpcErr(mc, 'grant_event_operator', {
    p_actor: actorId, p_event_id: eventA.id, p_user_id: mgr.userId, p_permission: 'OWNER', p_reason: 'x',
  });
  check('MANAGER: grant_event_operator 직접 호출 차단', esc != null, esc ?? '(에러 없음!)');

  const anon = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const eAnon = await rpcErr(anon, 'grant_event_operator', {
    p_actor: actorId, p_event_id: eventA.id, p_user_id: mgr.userId, p_permission: 'OWNER', p_reason: 'x',
  });
  check('anon: 운영자 RPC 차단', eAnon != null, eAnon ?? '(에러 없음!)');

  // 6. 회수 후 권한 소멸
  console.log('\n▶ 권한 회수 반영');
  await admin.rpc('revoke_event_operator', {
    p_actor: actorId, p_event_id: eventA.id, p_user_id: vwr.userId, p_reason: 'F 검증 회수',
  });
  const vAafter = await cap(vc, eventA.id);
  check('VIEWER: 회수 후 A view = F', !vAafter.view, JSON.stringify(vAafter));
}

async function cleanup() {
  console.log('\n▶ 정리(원복)');
  for (const c of created) {
    // public.users 행 삭제 → event_operator_roles(user_id ON DELETE CASCADE) 동반 제거.
    const { error: de } = await admin.from('users').delete().eq('id', c.userId);
    // Auth 사용자 삭제(로그인 차단 + 이메일 회수).
    const { error: ae } = await admin.auth.admin.deleteUser(c.authId);
    console.log(`  · 정리: ${c.label}${de ? ` (users:${de.message})` : ''}${ae ? ` (auth:${ae.message})` : ''}`);
  }
}

let exitCode = 0;
try {
  await main();
} catch (e) {
  console.error(`\n✗ 실행 오류: ${e.message}`);
  exitCode = 1;
} finally {
  await cleanup();
}

const passed = results.filter((r) => r.pass).length;
const failed = results.length - passed;
console.log(`\n═══ 결과: ${passed} 통과 / ${failed} 실패 (총 ${results.length}) ═══`);
process.exit(exitCode || (failed > 0 ? 1 : 0));
