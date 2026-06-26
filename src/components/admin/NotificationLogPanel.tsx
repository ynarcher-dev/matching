import { useMemo } from 'react';
import { Card } from '@/components/common/Card';
import { Alert } from '@/components/common/Alert';
import { Button } from '@/components/common/Button';
import { useEventNotifications, useRetryNotification } from '@/hooks/useNotifications';
import { isRetryable, maskDestination, summarizeNotifications } from '@/lib/notification';
import {
  CHANNEL_LABELS,
  NOTIFICATION_STATUS_LABELS,
  notificationTypeLabel,
} from '@/lib/labels';
import { formatDateTime } from '@/lib/datetime';
import type { NotificationLog, NotificationStatus } from '@/types/notification';

interface NotificationLogPanelProps {
  eventId: string;
  timezone: string;
}

const STATUS_BADGE: Record<NotificationStatus, string> = {
  PENDING: 'border-amber-300 bg-amber-50 text-amber-700',
  SENT: 'border-emerald-300 bg-emerald-50 text-emerald-700',
  FAILED: 'border-brand bg-danger-surface text-brand',
};

/**
 * 알림 발송 현황 (Phase 7 슬라이스 1, security_transactions.md 4장).
 * 예약 생성/변경/취소·예약 시작 안내 등 자동 적재된 알림의 발송 상태(대기/완료/영구실패)와
 * 재시도 횟수·다음 재시도 시각·오류 메시지를 보여주고, 영구 실패 건은 관리자가 수동 재시도한다.
 * 발송 대상(연락처)은 마스킹해 노출한다.
 */
export function NotificationLogPanel({ eventId, timezone }: NotificationLogPanelProps) {
  const logsQ = useEventNotifications(eventId);
  const retry = useRetryNotification(eventId);

  const logs = useMemo<NotificationLog[]>(() => logsQ.data ?? [], [logsQ.data]);
  const summary = useMemo(() => summarizeNotifications(logs), [logs]);

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-bold text-neutral-base">알림 발송 현황</h2>
          <span className="text-xs text-neutral-base/50">15초마다 자동 갱신</span>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatBox label="전체" value={summary.total} />
          <StatBox label="대기/재시도" value={summary.pending} />
          <StatBox label="발송 완료" value={summary.sent} />
          <StatBox label="영구 실패" value={summary.failed} tone="warn" />
        </div>

        {retry.isError && (
          <Alert tone="error">{(retry.error as Error).message ?? '재시도에 실패했습니다.'}</Alert>
        )}
      </Card>

      <Card className="flex flex-col gap-3 p-5">
        <h3 className="text-base font-bold text-neutral-base">발송 로그</h3>

        {logsQ.isError ? (
          <Alert tone="error">알림 로그를 불러오지 못했습니다.</Alert>
        ) : logs.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-neutral-base/60">
            아직 발송된 알림이 없습니다. 예약 확정·변경·취소 또는 예약 시작 시 자동으로 적재됩니다.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
            {logs.map((log) => (
              <li key={log.id} className="flex flex-col gap-1.5 px-3 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-md border px-2 py-0.5 text-xs font-semibold ${STATUS_BADGE[log.status]}`}
                    >
                      {NOTIFICATION_STATUS_LABELS[log.status]}
                    </span>
                    <span className="text-sm font-semibold text-neutral-base">
                      {notificationTypeLabel(log.notification_type)}
                    </span>
                    <span className="text-xs text-neutral-base/60">
                      {CHANNEL_LABELS[log.channel]} · {maskDestination(log.channel, log.destination)}
                    </span>
                  </div>
                  {isRetryable(log) && (
                    <Button
                      variant="outline"
                      onClick={() => retry.mutate(log.id)}
                      disabled={retry.isPending}
                    >
                      재시도
                    </Button>
                  )}
                </div>

                <p className="text-sm text-neutral-base/80">{log.content}</p>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-neutral-base/50">
                  <span>적재 {formatDateTime(log.created_at, timezone)}</span>
                  {log.retry_count > 0 && <span>재시도 {log.retry_count}/3회</span>}
                  {log.status === 'PENDING' && log.next_retry_at && (
                    <span>다음 시도 {formatDateTime(log.next_retry_at, timezone)}</span>
                  )}
                  {log.error_message && (
                    <span className="text-brand">오류: {log.error_message}</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function StatBox({
  label,
  value,
  tone = 'base',
}: {
  label: string;
  value: number;
  tone?: 'base' | 'warn';
}) {
  return (
    <div className="rounded-xl border border-border bg-surface/40 px-3 py-3 text-center">
      <p className={`text-2xl font-bold ${tone === 'warn' ? 'text-brand' : 'text-neutral-base'}`}>
        {value}
      </p>
      <p className="mt-0.5 text-xs font-medium text-neutral-base/60">{label}</p>
    </div>
  );
}
