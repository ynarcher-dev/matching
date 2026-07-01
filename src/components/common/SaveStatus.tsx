import type { AutoSaveStatus } from '@/hooks/useAutoSaveText';

/**
 * 자동 저장 상태 표시(저장 버튼 대체). useAutoSaveText 와 함께 쓴다.
 * saving = 저장 중 / saved = 저장됨 / error = 실패 메시지 / idle = 표시 없음.
 */
export function SaveStatus({
  status,
  error,
}: {
  status: AutoSaveStatus;
  error: string | null;
}) {
  if (status === 'saving') {
    return <span className="text-xs text-neutral-base/50">저장 중…</span>;
  }
  if (status === 'saved') {
    return <span className="text-xs text-success">✓ 저장됨</span>;
  }
  if (status === 'error') {
    return (
      <span className="text-xs font-medium text-brand">
        저장 실패{error ? `: ${error}` : ''}
      </span>
    );
  }
  return null;
}
