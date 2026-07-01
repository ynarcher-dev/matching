import { useMemo, useState } from 'react';
import { Card } from '@/components/common/Card';
import { Alert } from '@/components/common/Alert';
import { FullScreenLoader } from '@/components/common/FullScreenLoader';
import { StartupEventHeader } from '@/components/startup/StartupEventHeader';
import { useMyExpertEvents } from '@/hooks/useExpertPortal';
import type { EventRow } from '@/types/event';

/**
 * 전문가 안내 사항 화면 (스타트업 안내 사항과 동일 구성).
 * 상단에 참가 행사 카드를 노출하고, 본문에는 행사 운영진 공지를 표시한다(현재는 자리표시).
 */
export function ExpertNoticesView() {
  const eventsQ = useMyExpertEvents();
  const events = useMemo(() => eventsQ.data ?? [], [eventsQ.data]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // 기본 선택: 진행(PROGRESS) 행사 우선, 없으면 첫 행사.
  const event = useMemo<EventRow | undefined>(() => {
    if (selectedId) return events.find((e) => e.id === selectedId) ?? events[0];
    return events.find((e) => e.status === 'PROGRESS') ?? events[0];
  }, [events, selectedId]);

  if (eventsQ.isLoading) return <FullScreenLoader />;
  if (eventsQ.isError) {
    return (
      <Card className="p-6">
        <Alert tone="error">
          행사 정보를 불러오지 못했습니다. {(eventsQ.error as Error | null)?.message ?? ''}
        </Alert>
      </Card>
    );
  }
  if (!event) {
    return (
      <Card className="p-8">
        <p className="text-center text-sm text-neutral-base/60">
          현재 참가 중인 행사가 없습니다. 행사가 시작되면 안내 사항이 표시됩니다.
        </p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <StartupEventHeader events={events} event={event} onSelect={setSelectedId} />

      <Card className="flex flex-col gap-2 p-6">
        <h1 className="text-lg font-bold text-neutral-base">안내 사항</h1>
        <p className="text-sm text-neutral-base/70">
          행사 운영진이 등록한 공지·안내가 이곳에 표시됩니다.
        </p>
        <span className="mt-2 inline-block w-fit rounded-md bg-brand px-3 py-1 text-sm font-semibold text-white">
          준비 중 — 공지 등록 기능은 다음 단계에서 제공됩니다.
        </span>
      </Card>
    </div>
  );
}
