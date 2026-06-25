import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { supabase } from '@/lib/supabaseClient';
import { participantClient } from '@/lib/participantClient';
import {
  getParticipantToken,
  setParticipantToken,
  isJwtExpired,
} from '@/lib/participantSession';
import type {
  AppUser,
  AuthMode,
  AuthStatus,
  OtpRequestResult,
  ParticipantLoginResult,
} from '@/types/auth';

/** users 행에서 셸이 필요로 하는 최소 컬럼. */
const USER_COLUMNS =
  'id,email,name,role,company_name,representative_name,expert_position,is_super_admin';

export type AuthErrorKind = 'invalid' | 'forbidden' | 'network' | 'unknown';

export class AuthError extends Error {
  kind: AuthErrorKind;
  constructor(kind: AuthErrorKind, message: string) {
    super(message);
    this.name = 'AuthError';
    this.kind = kind;
  }
}

interface AuthState {
  status: AuthStatus;
  mode: AuthMode | null;
  user: AppUser | null;
  /** 앱 마운트 시 1회: 저장된 세션/토큰을 검증해 status 를 확정한다. */
  bootstrap: () => Promise<void>;
  loginOperator: (email: string, password: string) => Promise<AppUser>;
  /** 1단계: 등록 연락처로 OTP 발송 요청(계정 열거 방지 generic 응답). */
  requestOtp: (identifier: string) => Promise<OtpRequestResult>;
  /** 2단계: 6자리 OTP 검증 → 커스텀 JWT 발급·세션 설정. */
  verifyOtp: (identifier: string, code: string) => Promise<AppUser>;
  /** 현장 예외용 1회용 로그인 링크 토큰 소비 → 커스텀 JWT 발급·세션 설정. */
  consumeEmergencyToken: (token: string) => Promise<AppUser>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      status: 'loading',
      mode: null,
      user: null,

      bootstrap: async () => {
        const { mode, user } = get();
        // 참가자: 커스텀 JWT 가 살아있고(미만료) 프로필이 복원돼 있으면 인증 유지.
        if (mode === 'participant') {
          const token = getParticipantToken();
          if (token && !isJwtExpired(token) && user) {
            set({ status: 'authenticated' });
            return;
          }
          await get().logout();
          return;
        }
        // 운영진: Supabase 세션이 유효할 때만 인증 유지.
        if (mode === 'operator') {
          const { data } = await supabase.auth.getSession();
          if (data.session && user) {
            set({ status: 'authenticated' });
            return;
          }
          await get().logout();
          return;
        }
        set({ status: 'unauthenticated', mode: null, user: null });
      },

      loginOperator: async (email, password) => {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) {
          if (/network|fetch/i.test(error.message)) {
            throw new AuthError('network', error.message);
          }
          throw new AuthError('invalid', error.message);
        }

        const { data: profile, error: profileError } = await supabase
          .from('users')
          .select(USER_COLUMNS)
          .is('deleted_at', null)
          .eq('auth_user_id', (await supabase.auth.getUser()).data.user?.id ?? '')
          .single<AppUser>();

        if (profileError || !profile) {
          await supabase.auth.signOut();
          throw new AuthError('forbidden', '운영진 계정 프로필을 찾을 수 없습니다.');
        }
        if (profile.role !== 'ADMIN' && profile.role !== 'STAFF') {
          await supabase.auth.signOut();
          throw new AuthError('forbidden', '운영진 전용 로그인입니다.');
        }

        set({ status: 'authenticated', mode: 'operator', user: profile });
        return profile;
      },

      requestOtp: async (identifier) => {
        try {
          const { data, error } = await supabase.functions.invoke<OtpRequestResult>(
            'participant-otp-request',
            { body: { identifier: identifier.trim() } },
          );
          // 계정 열거 방지: 4xx(자격/존재) 구분 없이 서버는 generic 200 을 반환한다.
          // 여기서 error 는 사실상 네트워크/서버(5xx)만 의미한다.
          if (error) throw new AuthError('network', error.message);
          return data ?? { ok: true, retry_after: 60 };
        } catch (e) {
          if (e instanceof AuthError) throw e;
          throw new AuthError('network', (e as Error).message);
        }
      },

      verifyOtp: async (identifier, code) => {
        let result: ParticipantLoginResult;
        try {
          const { data, error } = await supabase.functions.invoke<ParticipantLoginResult>(
            'participant-otp-verify',
            { body: { identifier: identifier.trim(), code } },
          );
          if (error) {
            // FunctionsHttpError(4xx)=OTP 불일치/만료, 그 외=네트워크/서버
            const status = (error as { context?: { status?: number } }).context?.status;
            if (status && status >= 400 && status < 500) {
              throw new AuthError('invalid', '인증번호가 올바르지 않거나 만료되었습니다.');
            }
            throw new AuthError('network', error.message);
          }
          if (!data?.token || !data.user) {
            throw new AuthError('invalid', '인증번호가 올바르지 않거나 만료되었습니다.');
          }
          result = data;
        } catch (e) {
          if (e instanceof AuthError) throw e;
          throw new AuthError('network', (e as Error).message);
        }

        setParticipantToken(result.token);
        set({ status: 'authenticated', mode: 'participant', user: result.user });
        return result.user;
      },

      consumeEmergencyToken: async (token) => {
        let result: ParticipantLoginResult;
        try {
          const { data, error } = await supabase.functions.invoke<ParticipantLoginResult>(
            'emergency-login',
            { body: { token: token.trim() } },
          );
          if (error) {
            const status = (error as { context?: { status?: number } }).context?.status;
            if (status && status >= 400 && status < 500) {
              throw new AuthError('invalid', '로그인 링크가 만료되었거나 이미 사용되었습니다.');
            }
            throw new AuthError('network', error.message);
          }
          if (!data?.token || !data.user) {
            throw new AuthError('invalid', '로그인 링크가 유효하지 않습니다.');
          }
          result = data;
        } catch (e) {
          if (e instanceof AuthError) throw e;
          throw new AuthError('network', (e as Error).message);
        }

        setParticipantToken(result.token);
        set({ status: 'authenticated', mode: 'participant', user: result.user });
        return result.user;
      },

      logout: async () => {
        const mode = get().mode;
        if (mode === 'operator') {
          await supabase.auth.signOut();
        }
        setParticipantToken(null);
        // 참가자 클라이언트 캐시 정리(있다면)
        await participantClient.removeAllChannels?.();
        set({ status: 'unauthenticated', mode: null, user: null });
      },
    }),
    {
      name: 'yna.auth',
      // 토큰은 participantSession 이 관리. 여기선 mode/user 만 복원한다.
      partialize: (s) => ({ mode: s.mode, user: s.user }),
    },
  ),
);
