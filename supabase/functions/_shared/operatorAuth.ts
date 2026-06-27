// =============================================================================
// operatorAuth.ts — 운영자 관리 Edge Function 공용 최고관리자 인증
// =============================================================================
// 호출자의 Supabase Auth JWT 를 검증하고 users.role='ADMIN' AND is_super_admin 을
// 확인한다. 모든 운영자 관리 함수는 최고관리자 전용이다(명세 4.1).
// service_role 클라이언트(admin)는 RLS 를 우회하므로 권한 검증을 반드시 선행한다.
// =============================================================================
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

export const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

/** RLS 를 우회하는 service_role 클라이언트(권한 검증 이후에만 사용). */
export const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** 호출자가 최고관리자면 users.id 를 반환, 아니면 null. */
export async function authorizeSuperAdmin(req: Request): Promise<string | null> {
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
    .select('id, role, is_super_admin')
    .eq('auth_user_id', userData.user.id)
    .is('deleted_at', null)
    .single();

  if (!profile || profile.role !== 'ADMIN' || profile.is_super_admin !== true) return null;
  return profile.id as string;
}
