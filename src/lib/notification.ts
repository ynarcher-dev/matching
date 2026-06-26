import type { NotificationChannel, NotificationLog, NotificationStatus } from '@/types/notification';

/**
 * 알림 로그 표시용 순수 함수 (Phase 7 슬라이스 1).
 * 발송 대상(destination)은 화면·일반 로그에 마스킹해 노출한다(db_schema.md 2.15).
 * 서버측 마스킹(supabase/functions/_shared/notifier.ts maskDestination)과 동일 규칙.
 */

/** 수신 대상 마스킹: 이메일은 앞 2자만, 전화번호는 끝 4자리만 노출. */
export function maskDestination(channel: NotificationChannel, destination: string): string {
  const value = (destination ?? '').trim();
  if (!value) return '***';
  if (channel === 'EMAIL') {
    const [local, domain] = value.split('@');
    if (!domain) return '***';
    const head = local.slice(0, 2);
    return `${head}${'*'.repeat(Math.max(local.length - 2, 1))}@${domain}`;
  }
  const tail = value.slice(-4);
  return `${'*'.repeat(Math.max(value.length - 4, 0))}${tail}`;
}

/** FAILED 상태만 관리자 수동 재시도 대상이다. */
export function isRetryable(log: Pick<NotificationLog, 'status'>): boolean {
  return log.status === 'FAILED';
}

/** 발송 상태별 집계(요약 카드용). */
export interface NotificationSummary {
  total: number;
  pending: number;
  sent: number;
  failed: number;
}

export function summarizeNotifications(logs: NotificationLog[]): NotificationSummary {
  const summary: NotificationSummary = { total: 0, pending: 0, sent: 0, failed: 0 };
  for (const log of logs) {
    summary.total += 1;
    if (log.status === 'PENDING') summary.pending += 1;
    else if (log.status === 'SENT') summary.sent += 1;
    else if (log.status === 'FAILED') summary.failed += 1;
  }
  return summary;
}

/** 진행도 배지/정렬용 상태 가중치(실패 > 대기 > 완료 순으로 주목도 부여). */
export function statusWeight(status: NotificationStatus): number {
  if (status === 'FAILED') return 0;
  if (status === 'PENDING') return 1;
  return 2;
}

/** 실패/대기를 먼저, 그 안에서는 최신 갱신 순으로 정렬(주목해야 할 항목 우선). */
export function sortByAttention(logs: NotificationLog[]): NotificationLog[] {
  return [...logs].sort((a, b) => {
    const w = statusWeight(a.status) - statusWeight(b.status);
    if (w !== 0) return w;
    const at = a.updated_at ?? a.created_at;
    const bt = b.updated_at ?? b.created_at;
    return bt.localeCompare(at);
  });
}
