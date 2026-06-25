import { useMemo, useState } from 'react';
import { Button } from '@/components/common/Button';
import { Card } from '@/components/common/Card';
import { Alert } from '@/components/common/Alert';
import { FullScreenLoader } from '@/components/common/FullScreenLoader';
import { EventCard } from '@/components/admin/EventCard';
import { EventFormModal } from '@/components/admin/EventFormModal';
import { CancelEventModal } from '@/components/admin/CancelEventModal';
import { useEvents } from '@/hooks/useEvents';
import { useAuthStore } from '@/stores/authStore';
import { EVENT_STATUS_LABELS } from '@/lib/labels';
import type { EventFilter, EventWithCounts } from '@/types/event';

const FILTER_TABS: { value: EventFilter; label: string }[] = [
  { value: 'ALL', label: '전체' },
  { value: 'DRAFT', label: EVENT_STATUS_LABELS.DRAFT },
  { value: 'BOOKING', label: EVENT_STATUS_LABELS.BOOKING },
  { value: 'ALLOCATION', label: EVENT_STATUS_LABELS.ALLOCATION },
  { value: 'PROGRESS', label: EVENT_STATUS_LABELS.PROGRESS },
  { value: 'FINISHED', label: EVENT_STATUS_LABELS.FINISHED },
  { value: 'CANCELLED', label: EVENT_STATUS_LABELS.CANCELLED },
];

/**
 * 행사 목록 및 개설 페이지 (page_admin_event_list.md §1).
 * 상태 필터 탭 + 행사명 검색 + 카드 그리드 + 빈 화면 대응.
 * 행사 수는 적으므로 필터·검색은 화면 단에서 적용한다.
 */
export function EventListView() {
  const { data: events, isLoading, isError, error } = useEvents();
  const isSuperAdmin = useAuthStore((s) => s.user?.is_super_admin ?? false);

  const [filter, setFilter] = useState<EventFilter>('ALL');
  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<EventWithCounts | null>(null);
  const [cancelTarget, setCancelTarget] = useState<EventWithCounts | null>(null);

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return (events ?? []).filter((e) => {
      const matchStatus = filter === 'ALL' || e.status === filter;
      const matchSearch = !keyword || e.title.toLowerCase().includes(keyword);
      return matchStatus && matchSearch;
    });
  }, [events, filter, search]);

  const openCreate = () => {
    setEditTarget(null);
    setFormOpen(true);
  };
  const openEdit = (event: EventWithCounts) => {
    setEditTarget(event);
    setFormOpen(true);
  };

  if (isLoading) return <FullScreenLoader />;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-neutral-base">행사 운영 관리</h1>
        <Button onClick={openCreate}>+ 새 행사 개설</Button>
      </header>

      {isError && <Alert tone="error">행사 목록을 불러오지 못했습니다. {(error as Error).message}</Alert>}

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-1.5">
          {FILTER_TABS.map((tab) => {
            const active = filter === tab.value;
            return (
              <button
                key={tab.value}
                type="button"
                onClick={() => setFilter(tab.value)}
                className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors ${
                  active
                    ? 'border-brand bg-brand text-white'
                    : 'border-border bg-white text-neutral-base hover:bg-surface'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="행사명 검색"
          aria-label="행사명 검색"
          className="w-full max-w-xs rounded-lg border border-border bg-white px-3 py-2 text-base text-neutral-base outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/30"
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState hasAny={(events ?? []).length > 0} onCreate={openCreate} />
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((event) => (
            <EventCard
              key={event.id}
              event={event}
              onEdit={openEdit}
              canCancel={isSuperAdmin}
              onCancel={setCancelTarget}
            />
          ))}
        </div>
      )}

      <EventFormModal open={formOpen} onClose={() => setFormOpen(false)} event={editTarget} />
      <CancelEventModal
        open={cancelTarget !== null}
        onClose={() => setCancelTarget(null)}
        event={cancelTarget}
      />
    </div>
  );
}

/** 빈 화면: 행사가 아예 없을 때와 필터 결과가 없을 때를 구분한다. */
function EmptyState({ hasAny, onCreate }: { hasAny: boolean; onCreate: () => void }) {
  if (hasAny) {
    return (
      <Card className="p-10 text-center">
        <p className="text-sm text-neutral-base/70">조건에 맞는 행사가 없습니다.</p>
      </Card>
    );
  }
  return (
    <Card className="flex flex-col items-center gap-4 p-12 text-center">
      <p className="text-base font-semibold text-neutral-base">
        등록된 행사가 없습니다. 첫 번째 행사를 개설해 보세요!
      </p>
      <Button onClick={onCreate}>+ 새 행사 개설</Button>
    </Card>
  );
}
