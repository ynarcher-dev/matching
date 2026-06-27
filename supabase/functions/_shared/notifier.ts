// =============================================================================
// notifier.ts — OTP/알림 발송 어댑터 (Edge Functions 공용)
// 출처: docs/security_transactions.md 4장, docs/page_auth_layout.md §1.4,
//       docs/event_notification_api_plan.md §6(공급사 어댑터), docs/page_admin_notification_settings.md
// =============================================================================
// 어댑터 인터페이스 + Mock + Solapi(SMS/알림톡) + Fallback(알림톡→SMS) 구현.
//   - 비밀키는 supabase secrets(환경변수)로만 주입한다. 저장소 커밋 금지.
//   - 공급사 설정이 불완전하면 항상 Mock 로 안전하게 폴백한다(외부 API 미호출).
//   - OTP 원문은 발송에만 사용하고 DB/애플리케이션 로그에 저장하지 않는다.
//     (Mock 도 기본적으로 원문을 로그에 남기지 않는다. OTP_DEV_ECHO=true 일 때만 출력.)
// =============================================================================

export type NotifyChannel = 'EMAIL' | 'SMS' | 'ALIMTALK';

export interface NotifyMessage {
  channel: NotifyChannel;
  /** 정규화된 수신 대상(이메일 주소 또는 휴대전화 번호). */
  destination: string;
  /** 발송 본문. OTP 원문이 포함되므로 로깅 대상에서 제외한다. */
  body: string;
  /** 분류/감사용 메타(발송 종류 등). 원문 비밀값을 넣지 않는다. */
  kind?: string;
}

export interface NotifierAdapter {
  send(message: NotifyMessage): Promise<{ ok: boolean }>;
}

/** 공급사 설정. 환경변수에서 해석한다. */
export interface ProviderConfig {
  provider: 'MOCK' | 'SOLAPI';
  apiKey?: string;
  apiSecret?: string;
  senderPhone?: string;
  /** 알림톡 채널(플러스친구) ID. 알림톡 사용 시 필요. */
  pfId?: string;
}

/** 수신 대상 마스킹(로그·관리자 화면 표시용). */
export function maskDestination(channel: NotifyChannel, destination: string): string {
  if (channel === 'EMAIL') {
    const [local, domain] = destination.split('@');
    if (!domain) return '***';
    const head = local.slice(0, 2);
    return `${head}${'*'.repeat(Math.max(local.length - 2, 1))}@${domain}`;
  }
  // 전화번호: 끝 4자리만 노출.
  const tail = destination.slice(-4);
  return `${'*'.repeat(Math.max(destination.length - 4, 0))}${tail}`;
}

/**
 * 개발용 Mock 어댑터. 실제 발송 없이 감사 로그(마스킹)만 남긴다.
 * 본문(OTP 원문 포함)은 기본적으로 로깅하지 않는다.
 */
export class MockNotifier implements NotifierAdapter {
  async send(message: NotifyMessage): Promise<{ ok: boolean }> {
    const masked = maskDestination(message.channel, message.destination);
    const echo = Deno.env.get('OTP_DEV_ECHO') === 'true';
    if (echo) {
      // ⚠ 로컬 디버깅 전용. 운영 환경에서는 OTP_DEV_ECHO 를 설정하지 않는다.
      console.log(`[notifier:mock] ${message.channel} → ${masked} :: ${message.body}`);
    } else {
      console.log(`[notifier:mock] ${message.channel} → ${masked} (kind=${message.kind ?? 'n/a'})`);
    }
    return { ok: true };
  }
}

// -----------------------------------------------------------------------------
// Solapi 어댑터
// -----------------------------------------------------------------------------
// 인증: HMAC-SHA256. signature = HMAC-SHA256(date + salt, apiSecret) hex.
//   Authorization: HMAC-SHA256 apiKey=..., date=..., salt=..., signature=...
// 발송: POST https://api.solapi.com/messages/v4/send  { message: {...} }
// 참고: SMS(<=90byte)/LMS 자동 승격은 type 미지정 시 공급사가 처리. 여기선 명시.
// =============================================================================
const SOLAPI_ENDPOINT = 'https://api.solapi.com/messages/v4/send';

async function solapiAuthHeader(apiKey: string, apiSecret: string): Promise<string> {
  const date = new Date().toISOString();
  const salt = crypto.randomUUID().replace(/-/g, '');
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(apiSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(date + salt));
  const signature = Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
}

/** 한국 휴대전화 번호 정규화(숫자만, 길이 검증은 호출측 책임). */
function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

interface SolapiBaseOptions {
  apiKey: string;
  apiSecret: string;
  senderPhone: string;
}

/** Solapi SMS/LMS 발송 어댑터. */
export class SolapiSmsNotifier implements NotifierAdapter {
  constructor(private readonly opts: SolapiBaseOptions) {}

  async send(message: NotifyMessage): Promise<{ ok: boolean }> {
    const to = digitsOnly(message.destination);
    // 본문 바이트 길이로 SMS/LMS 구분(EUC-KR 기준 90byte 초과는 LMS).
    const byteLen = new TextEncoder().encode(message.body).length;
    const type = byteLen > 90 ? 'LMS' : 'SMS';
    const payload = {
      message: {
        to,
        from: digitsOnly(this.opts.senderPhone),
        text: message.body,
        type,
      },
    };
    const auth = await solapiAuthHeader(this.opts.apiKey, this.opts.apiSecret);
    const res = await fetch(SOLAPI_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error(`[notifier:solapi-sms] HTTP ${res.status} ${detail.slice(0, 200)}`);
      return { ok: false };
    }
    return { ok: true };
  }
}

/** Solapi 카카오 알림톡(ATA) 발송 어댑터. 승인된 템플릿 코드를 사용한다. */
export class SolapiAlimtalkNotifier implements NotifierAdapter {
  constructor(
    private readonly opts: SolapiBaseOptions & { pfId: string },
  ) {}

  async send(message: NotifyMessage): Promise<{ ok: boolean }> {
    const to = digitsOnly(message.destination);
    // 알림톡은 승인된 템플릿이 필요하다. 템플릿 코드는 kind(notification_type)로 매핑한다.
    // 템플릿 미연동 단계에서는 text 만 채워 보내되, 미승인 시 공급사가 거절한다.
    const payload = {
      message: {
        to,
        from: digitsOnly(this.opts.senderPhone),
        type: 'ATA',
        kakaoOptions: {
          pfId: this.opts.pfId,
          // templateId 는 템플릿 연동(슬라이스 후속)에서 kind→templateId 매핑으로 채운다.
          disableSms: true,
          variables: {},
        },
        text: message.body,
      },
    };
    const auth = await solapiAuthHeader(this.opts.apiKey, this.opts.apiSecret);
    const res = await fetch(SOLAPI_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error(`[notifier:solapi-ata] HTTP ${res.status} ${detail.slice(0, 200)}`);
      return { ok: false };
    }
    return { ok: true };
  }
}

/**
 * 알림톡 우선 + 실패 시 SMS fallback 어댑터 (정책 ALIMTALK_SMS).
 * 1차 알림톡 발송 실패 시 SMS 로 재시도하고, 둘 중 하나라도 성공하면 ok.
 */
export class FallbackNotifier implements NotifierAdapter {
  constructor(
    private readonly primary: NotifierAdapter,
    private readonly secondary: NotifierAdapter,
  ) {}

  async send(message: NotifyMessage): Promise<{ ok: boolean }> {
    const first = await this.primary.send(message).catch(() => ({ ok: false }));
    if (first.ok) return { ok: true };
    console.warn('[notifier:fallback] 알림톡 실패 → SMS 재시도');
    return this.secondary.send({ ...message, channel: 'SMS' });
  }
}

// -----------------------------------------------------------------------------
// 설정 해석 + 어댑터 팩토리
// -----------------------------------------------------------------------------
/** 환경변수에서 공급사 설정을 해석한다. */
export function resolveProviderConfig(provider: 'MOCK' | 'SOLAPI'): ProviderConfig {
  if (provider !== 'SOLAPI') return { provider: 'MOCK' };
  return {
    provider: 'SOLAPI',
    apiKey: Deno.env.get('SOLAPI_API_KEY') ?? undefined,
    apiSecret: Deno.env.get('SOLAPI_API_SECRET') ?? undefined,
    senderPhone: Deno.env.get('SOLAPI_SENDER_PHONE') ?? undefined,
    pfId: Deno.env.get('SOLAPI_PF_ID') ?? undefined,
  };
}

/** SMS 발송에 필요한 키가 모두 있는가. */
export function isSmsConfigured(cfg: ProviderConfig): boolean {
  return Boolean(
    cfg.provider === 'SOLAPI' && cfg.apiKey && cfg.apiSecret && cfg.senderPhone,
  );
}

/** 알림톡 발송에 필요한 키가 모두 있는가(SMS 키 + pfId). */
export function isAlimtalkConfigured(cfg: ProviderConfig): boolean {
  return isSmsConfigured(cfg) && Boolean(cfg.pfId);
}

/**
 * 메시지 채널 + 정책에 맞는 어댑터를 반환한다.
 * 설정이 불완전하면 Mock 로 안전 폴백(외부 API 미호출).
 * @param policy 행사 알림 정책(ALIMTALK_SMS 면 fallback 구성).
 */
export function notifierFor(
  cfg: ProviderConfig,
  channel: NotifyChannel,
  policy?: string,
): NotifierAdapter {
  if (cfg.provider !== 'SOLAPI') return new MockNotifier();

  // EMAIL 은 현재 실공급사 미연동 → Mock.
  if (channel === 'EMAIL') return new MockNotifier();

  if (channel === 'SMS') {
    return isSmsConfigured(cfg)
      ? new SolapiSmsNotifier({
          apiKey: cfg.apiKey!,
          apiSecret: cfg.apiSecret!,
          senderPhone: cfg.senderPhone!,
        })
      : new MockNotifier();
  }

  // ALIMTALK
  if (!isAlimtalkConfigured(cfg)) {
    // 알림톡 설정 불완전 → SMS 가능하면 SMS, 아니면 Mock.
    return isSmsConfigured(cfg)
      ? new SolapiSmsNotifier({
          apiKey: cfg.apiKey!,
          apiSecret: cfg.apiSecret!,
          senderPhone: cfg.senderPhone!,
        })
      : new MockNotifier();
  }

  const base: SolapiBaseOptions = {
    apiKey: cfg.apiKey!,
    apiSecret: cfg.apiSecret!,
    senderPhone: cfg.senderPhone!,
  };
  const alimtalk = new SolapiAlimtalkNotifier({ ...base, pfId: cfg.pfId! });

  // ALIMTALK_SMS 정책이면 fallback 구성.
  if (policy === 'ALIMTALK_SMS' && isSmsConfigured(cfg)) {
    return new FallbackNotifier(alimtalk, new SolapiSmsNotifier(base));
  }
  return alimtalk;
}

/**
 * 기존 호출 호환용 기본 어댑터(인자 없는 getNotifier).
 * notification-dispatch 는 notifierFor(...) 로 채널별 선택을 직접 한다.
 */
export function getNotifier(): NotifierAdapter {
  return new MockNotifier();
}

/** OTP 발송 본문 템플릿(채널 공통). 메시지 자체는 로깅하지 않는다. */
export function otpMessageBody(otp: string): string {
  return `[YNA 비즈니스 매칭] 인증번호 ${otp} (5분 이내 입력). 본인이 요청하지 않았다면 무시하세요.`;
}
