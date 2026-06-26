import { useEffect, useState } from 'react';
import { formatCountdown, isCountdownWarning, remainingMs } from '@/lib/expertSchedule';

/**
 * 실시간 남은 상담 시간 카운트다운 (docs/page_expert_dashboard.md §1.2).
 * setInterval 로 1초마다 갱신하며, 5분 미만이면 빨간색 점멸 경고를 준다.
 * 표기 로직(MM:SS·경고 임계)은 lib/expertSchedule 의 순수 함수에 위임한다.
 */
export function CountdownTimer({ endIso }: { endIso: string }) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const ms = remainingMs(nowMs, endIso);
  const ended = ms <= 0;
  const warn = isCountdownWarning(ms);

  const tone = warn
    ? 'animate-pulse text-red-600'
    : ended
      ? 'text-neutral-base/40'
      : 'text-neutral-base';

  return (
    <div className="flex flex-col items-center">
      <span className="text-xs text-neutral-base/60">남은 시간</span>
      <span className={`font-mono text-3xl font-bold tabular-nums ${tone}`}>
        {ended ? '시간 종료' : formatCountdown(ms)}
      </span>
    </div>
  );
}
