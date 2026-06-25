import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Card } from '@/components/common/Card';
import { Button } from '@/components/common/Button';
import { TextField } from '@/components/common/TextField';
import { Alert } from '@/components/common/Alert';
import { ConfirmModal } from '@/components/common/ConfirmModal';
import { slotGenerationSchema } from '@/schemas/eventDetailSchemas';
import type { SlotGenerationValues } from '@/schemas/eventDetailSchemas';
import { useGenerateSlots, useClearUnbookedSlots } from '@/hooks/useEventDetailMutations';
import { buildSlotTrack, plannedSlotCount, slotTrackEndIso } from '@/lib/slots';
import { formatDateTime, isoToLocalInput, localInputToIso } from '@/lib/datetime';
import type { EventRow } from '@/types/event';
import type { EventParticipantRow, MatchingSlotRow } from '@/types/eventDetail';

interface SlotGenerationPanelProps {
  eventId: string;
  event: EventRow;
  participants: EventParticipantRow[];
  slots: MatchingSlotRow[];
  locked: boolean;
}

/** 미리보기에서 보여줄 최대 슬롯 시간 칩 수(전문가 1인 트랙 기준). */
const PREVIEW_LIMIT = 8;

/**
 * 슬롯 자동 생성 패널 (page_admin_event_detail.md §2.1 — 미팅 타임 슬롯 기초 매핑).
 * 행사 참가 전문가별로 동일한 시간 그리드(세션 길이·휴식·횟수)를 따라 빈 슬롯을 생성한다.
 * 생성은 generate_event_slots RPC(전문가별 빈 슬롯만 교체·예약 슬롯 보존), 초기화는 clear_unbooked_slots.
 */
export function SlotGenerationPanel({
  eventId,
  event,
  participants,
  slots,
  locked,
}: SlotGenerationPanelProps) {
  const tz = event.timezone;
  const generate = useGenerateSlots(eventId);
  const clear = useClearUnbookedSlots(eventId);
  const [showClear, setShowClear] = useState(false);
  const [createdCount, setCreatedCount] = useState<number | null>(null);
  const [clearedCount, setClearedCount] = useState<number | null>(null);

  const expertCount = useMemo(
    () => participants.filter((p) => p.participant_type === 'EXPERT').length,
    [participants],
  );

  const { emptyCount, bookedCount } = useMemo(() => {
    let empty = 0;
    let booked = 0;
    for (const s of slots) {
      if (s.session_status === 'CANCELLED') continue;
      if (s.startup_id) booked += 1;
      else if (s.session_status === 'WAITING') empty += 1;
    }
    return { emptyCount: empty, bookedCount: booked };
  }, [slots]);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<SlotGenerationValues>({
    resolver: zodResolver(slotGenerationSchema),
    defaultValues: {
      start_local: isoToLocalInput(event.event_start, tz),
      session_minutes: 40,
      break_minutes: 0,
      session_count: 6,
      replace_unbooked: true,
    },
  });

  const values = watch();

  // 미리보기: 입력이 유효 범위일 때만 트랙을 계산한다(타이핑 중 NaN 방어).
  const preview = useMemo(() => {
    const sm = Number(values.session_minutes);
    const bm = Number(values.break_minutes);
    const sc = Number(values.session_count);
    if (!values.start_local || !Number.isFinite(sm) || sm <= 0 || !Number.isFinite(sc) || sc <= 0) {
      return null;
    }
    let startIso: string;
    try {
      startIso = localInputToIso(values.start_local, tz);
    } catch {
      return null;
    }
    const breakMin = Number.isFinite(bm) && bm > 0 ? bm : 0;
    const track = buildSlotTrack(startIso, sm, breakMin, sc);
    const endIso = slotTrackEndIso(startIso, sm, breakMin, sc);
    return {
      track,
      endIso,
      planned: plannedSlotCount(expertCount, sc),
      exceedsEvent: endIso > event.event_end,
    };
  }, [values.start_local, values.session_minutes, values.break_minutes, values.session_count, tz, expertCount, event.event_end]);

  const onSubmit = handleSubmit((data) => {
    setCreatedCount(null);
    setClearedCount(null);
    generate.mutate(
      {
        startIso: localInputToIso(data.start_local, tz),
        sessionMinutes: data.session_minutes,
        breakMinutes: data.break_minutes,
        sessionCount: data.session_count,
        replaceUnbooked: data.replace_unbooked,
      },
      { onSuccess: (n) => setCreatedCount(n) },
    );
  });

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold text-neutral-base">슬롯 자동 생성</h2>
        <div className="flex flex-wrap gap-1.5 text-xs">
          <Stat label="전문가" value={`${expertCount}명`} />
          <Stat label="빈 슬롯" value={`${emptyCount}개`} />
          <Stat label="예약" value={`${bookedCount}개`} />
        </div>
      </div>

      <p className="text-sm text-neutral-base/70">
        참가 전문가 {expertCount}명에게 동일한 시간표를 생성합니다. 예약·진행 중인 슬롯은 보존되며, 같은
        시간대에 겹치는 기존 슬롯은 건너뜁니다.
      </p>

      {expertCount === 0 && (
        <Alert tone="info">먼저 참가 전문가를 지정해 주세요. 전문가가 있어야 슬롯을 생성할 수 있습니다.</Alert>
      )}

      {!locked && expertCount > 0 && (
        <form
          onSubmit={onSubmit}
          className="flex flex-col gap-3 rounded-xl border border-border bg-surface/40 p-3"
          noValidate
        >
          <TextField
            label="시작 시각"
            type="datetime-local"
            error={errors.start_local?.message}
            {...register('start_local')}
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <TextField
              label="세션 길이(분)"
              type="number"
              min={1}
              max={600}
              error={errors.session_minutes?.message}
              {...register('session_minutes')}
            />
            <TextField
              label="휴식(분)"
              type="number"
              min={0}
              max={600}
              error={errors.break_minutes?.message}
              {...register('break_minutes')}
            />
            <TextField
              label="세션 횟수"
              type="number"
              min={1}
              max={50}
              error={errors.session_count?.message}
              {...register('session_count')}
            />
          </div>

          <label className="flex items-center gap-2 text-sm font-medium text-neutral-base">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-border text-brand focus:ring-brand/30"
              {...register('replace_unbooked')}
            />
            기존 빈 슬롯을 지우고 다시 생성(예약된 슬롯은 유지)
          </label>

          {preview && (
            <div className="flex flex-col gap-2 rounded-lg border border-border bg-white p-3 text-sm">
              <p className="text-neutral-base">
                전문가 {expertCount}명 × {Number(values.session_count)}회 ={' '}
                <span className="font-bold text-brand">최대 {preview.planned}개</span> 슬롯 ·{' '}
                <span className="text-neutral-base/70">
                  {formatDateTime(localInputToIso(values.start_local, tz), tz)} ~{' '}
                  {formatDateTime(preview.endIso, tz)}
                </span>
              </p>
              <div className="flex flex-wrap gap-1">
                {preview.track.slice(0, PREVIEW_LIMIT).map((t) => (
                  <span
                    key={t.startIso}
                    className="rounded-full bg-surface px-2 py-0.5 text-xs font-medium text-neutral-base/70"
                  >
                    {formatDateTime(t.startIso, tz).slice(-5)}
                  </span>
                ))}
                {preview.track.length > PREVIEW_LIMIT && (
                  <span className="px-1 py-0.5 text-xs text-neutral-base/50">
                    외 {preview.track.length - PREVIEW_LIMIT}개
                  </span>
                )}
              </div>
              {preview.exceedsEvent && (
                <Alert tone="info">마지막 세션 종료가 행사 종료 시각을 넘습니다. 시간표를 확인해 주세요.</Alert>
              )}
            </div>
          )}

          {generate.isError && <Alert tone="error">{(generate.error as Error).message}</Alert>}
          {createdCount !== null && !generate.isError && (
            <Alert tone="success">슬롯 {createdCount}개를 생성했습니다.</Alert>
          )}

          <div className="flex flex-wrap gap-2">
            <Button type="submit" loading={generate.isPending}>
              슬롯 생성
            </Button>
            {emptyCount > 0 && (
              <Button type="button" variant="outline" onClick={() => setShowClear(true)}>
                빈 슬롯 초기화
              </Button>
            )}
          </div>
        </form>
      )}

      {clearedCount !== null && !clear.isError && (
        <Alert tone="success">빈 슬롯 {clearedCount}개를 삭제했습니다.</Alert>
      )}

      <ConfirmModal
        open={showClear}
        onClose={() => setShowClear(false)}
        title="빈 슬롯 초기화"
        message="예약되지 않은 빈 슬롯을 모두 삭제합니다. 예약·진행 중인 슬롯은 유지됩니다."
        confirmLabel="초기화"
        loading={clear.isPending}
        error={clear.isError ? (clear.error as Error).message : null}
        onConfirm={() => {
          setCreatedCount(null);
          clear.mutate(undefined, {
            onSuccess: (n) => {
              setClearedCount(n);
              setShowClear(false);
            },
          });
        }}
      />
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded-full border border-border bg-surface px-2.5 py-1 font-medium text-neutral-base/70">
      {label} <span className="font-bold text-neutral-base">{value}</span>
    </span>
  );
}
