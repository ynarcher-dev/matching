// =============================================================================
// notifier.ts — OTP/알림 발송 어댑터 (Edge Functions 공용)
// 출처: docs/security_transactions.md 4장, docs/page_auth_layout.md §1.4,
//       docs/agent_context_ui_otp_transition.md §7(발송 공급자 미확정 시 어댑터+Mock)
// =============================================================================
// 발송 공급자(이메일/SMS/알림톡)가 확정되기 전이라 어댑터 인터페이스 + Mock 구현만 둔다.
//   - 운영 환경은 Solapi 등 실제 어댑터로 교체(비밀키는 supabase secrets, 저장소 커밋 금지).
//   - OTP 원문은 발송에만 사용하고 DB/애플리케이션 로그에 저장하지 않는다.
//     (Mock 도 기본적으로 원문을 로그에 남기지 않는다. 로컬 디버깅이 꼭 필요하면
//      OTP_DEV_ECHO=true 일 때만 출력하며, 운영 환경에서는 절대 설정하지 않는다.)
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

/**
 * 현재 환경의 어댑터를 반환한다. 공급자 확정 후 NOTIFIER_PROVIDER 분기로
 * 실제 어댑터(SolapiNotifier 등)를 추가한다.
 */
export function getNotifier(): NotifierAdapter {
  // const provider = Deno.env.get('NOTIFIER_PROVIDER'); // 'solapi' | ...
  return new MockNotifier();
}

/** OTP 발송 본문 템플릿(채널 공통). 메시지 자체는 로깅하지 않는다. */
export function otpMessageBody(otp: string): string {
  return `[YNA 비즈니스 매칭] 인증번호 ${otp} (5분 이내 입력). 본인이 요청하지 않았다면 무시하세요.`;
}
