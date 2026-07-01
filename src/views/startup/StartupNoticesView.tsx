import { Card } from '@/components/common/Card';
import { Alert } from '@/components/common/Alert';
import { FullScreenLoader } from '@/components/common/FullScreenLoader';
import { StartupEventHeader } from '@/components/startup/StartupEventHeader';
import { useSelectedStartupEvent } from '@/hooks/useStartupPortal';

/**
 * 스타트업 안내 사항 화면 (startup_portal_layout_simplification_plan.md §3.3).
 * 상단에 3개 화면 공통 행사 카드를 노출해 마지막 선택 행사를 유지하고,
 * 본문에는 행사 운영진 공지를 표시한다(현재는 자리표시).
 */
export function StartupNoticesView() {
  const { eventsQ, events, event, setSelectedId } = useSelectedStartupEvent();

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
