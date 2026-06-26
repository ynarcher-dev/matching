/**
 * 인증·세션 도메인 타입 (dev_conventions.md 5장).
 * 두 인증 경로(운영진 Supabase Auth / 참가자 커스텀 JWT)를 단일 모델로 추상화한다.
 */

export type AppRole = 'ADMIN' | 'STAFF' | 'EXPERT' | 'STARTUP';

/** 인증 수단 구분. operator=Supabase Auth, participant=OTP 검증 후 커스텀 JWT */
export type AuthMode = 'operator' | 'participant';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

/** public.users 한 행(로그인 후 셸에서 쓰는 최소 프로필). */
export interface AppUser {
  id: string;
  email: string;
  name: string;
  role: AppRole;
  company_name: string | null;
  representative_name: string | null;
  expert_position: string | null;
  is_super_admin: boolean;
}

/** 참가자 로그인 성공 Edge Function 응답(커스텀 JWT + 프로필). */
export interface ParticipantLoginResult {
  token: string;
  user: AppUser;
}
