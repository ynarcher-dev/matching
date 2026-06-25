/**
 * 참가자(EXPERT/STARTUP) 커스텀 JWT 보관소.
 *
 * authStore 와 participantClient 양쪽에서 참조하는 토큰을 한 곳에 둬서
 * 두 모듈 간 순환 import 를 끊는다. 토큰 자체는 Edge Function 이 서명한
 * 커스텀 JWT 이며, 만료/세션무효화(session_version)는 서버가 매 요청 검증한다.
 */
const STORAGE_KEY = 'yna.participant.token';

let cachedToken: string | null = readInitial();

function readInitial(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function getParticipantToken(): string | null {
  return cachedToken;
}

export function setParticipantToken(token: string | null): void {
  cachedToken = token;
  try {
    if (token) localStorage.setItem(STORAGE_KEY, token);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* localStorage 미가용 환경에서는 메모리 캐시만 사용 */
  }
}

/**
 * JWT payload 를 검증 없이 디코드(클라이언트 표시·만료 조기차단용).
 * 신뢰 판정은 절대 이 값으로 하지 않으며 서버 RLS 가 최종 검증한다.
 */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const part = token.split('.')[1];
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** exp(초) 기준 만료 여부. payload 가 없거나 exp 없으면 만료로 간주. */
export function isJwtExpired(token: string, skewSeconds = 30): boolean {
  const payload = decodeJwtPayload(token);
  const exp = payload && typeof payload.exp === 'number' ? (payload.exp as number) : null;
  if (!exp) return true;
  return Date.now() / 1000 >= exp - skewSeconds;
}
