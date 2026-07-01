import { useMemo, useState } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Badge } from '@/components/common/Badge';
import { StatCardSection } from '@/components/common/StatCardSection';
import { SectionActionButton } from '@/components/common/ActionButton';
import { TextField } from '@/components/common/TextField';
import { Alert } from '@/components/common/Alert';
import { ConfirmModal } from '@/components/common/ConfirmModal';
import { toast } from '@/stores/toastStore';
import { slotGenerationSchema } from '@/schemas/eventDetailSchemas';
import type { SlotGenerationValues } from '@/schemas/eventDetailSchemas';
import { useGenerateSlots, useClearUnbookedSlots } from '@/hooks/useEventDetailMutations';
import { buildSlotTrack, plannedSlotCount, slotTrackEndIso, MAX_MEAL_WINDOWS } from '@/lib/slots';
import type { MealWindow } from '@/lib/slots';
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
    control,
    formState: { errors },
  } = useForm<SlotGenerationValues>({
    resolver: zodResolver(slotGenerationSchema),
    defaultValues: {
      start_local: isoToLocalInput(event.event_start, tz),
      session_minutes: 40,
      break_minutes: 0,
      session_count: 6,
      meals: [],
    },
  });

  const { fields: mealFields, append: appendMeal, remove: removeMeal } = useFieldArray({
    control,
    name: 'meals',
  });

  const values = watch();

  // 식사(점심) 시간대: 시작 시각의 날짜에 HH:mm 을 붙여 UTC ISO 로 변환. 유효한 구간만.
  const mealWindows = useMemo<MealWindow[]>(() => {
    const datePart = values.start_local?.slice(0, 10); // YYYY-MM-DD
    if (!datePart) return [];
    const out: MealWindow[] = [];
    for (const m of values.meals ?? []) {
      const s = m?.start?.trim();
      const e = m?.end?.trim();
      if (!s || !e || e <= s) continue;
      try {
        out.push({
          startIso: localInputToIso(`${datePart}T${s}`, tz),
          endIso: localInputToIso(`${datePart}T${e}`, tz),
        });
      } catch {
        // 잘못된 시각 조합은 미리보기에서 무시
      }
    }
    return out;
  }, [values.meals, values.start_local, tz]);

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
    const track = buildSlotTrack(startIso, sm, breakMin, sc, mealWindows);
    const endIso = slotTrackEndIso(startIso, sm, breakMin, sc, mealWindows);
    return {
      track,
      endIso,
      planned: plannedSlotCount(expertCount, sc),
      exceedsEvent: endIso > event.event_end,
    };
  }, [
    values.start_local,
    values.session_minutes,
    values.break_minutes,
    values.session_count,
    mealWindows,
    tz,
    expertCount,
    event.event_end,
  ]);

  const onSubmit = handleSubmit((data) => {
    const datePart = data.start_local.slice(0, 10);
    const mealStartsIso: string[] = [];
    const mealEndsIso: string[] = [];
    for (const m of data.meals ?? []) {
      const s = m.start.trim();
      const e = m.end.trim();
      if (!s || !e || e <= s) continue;
      mealStartsIso.push(localInputToIso(`${datePart}T${s}`, tz));
      mealEndsIso.push(localInputToIso(`${datePart}T${e}`, tz));
    }
    generate.mutate(
      {
        startIso: localInputToIso(data.start_local, tz),
        sessionMinutes: data.session_minutes,
        breakMinutes: data.break_minutes,
        sessionCount: data.session_count,
        mealStartsIso,
        mealEndsIso,
      },
      {
        onSuccess: (n) => toast.success(`슬롯 ${n}개를 생성했습니다.`),
        onError: (e) =>
          toast.error('슬롯을 생성하지 못했습니다.', { description: (e as Error).message }),
      },
    );
  });

  return (
    <StatCardSection
      title="슬롯 자동 생성"
      description="참가 전문가에게 동일한 시간표를 생성합니다. 식사 시간을 지정하면 그 시간대와 겹치는 세션은 식사 이후로 밀립니다. 예약·진행 중인 슬롯은 보존되며, 같은 시간대에 겹치는 기존 슬롯은 건너뜁니다."
      actions={
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge tone="neutral">전문가 {expertCount}명</Badge>
          <Badge tone="muted">빈 슬롯 {emptyCount}개</Badge>
          <Badge tone="brand">예약 {bookedCount}개</Badge>
        </div>
      }
    >
      {expertCount === 0 && (
        <Alert tone="info">
          먼저 참가 전문가를 지정해 주세요. 전문가가 있어야 슬롯을 생성할 수 있습니다.
        </Alert>
      )}

      {!locked && expertCount > 0 && (
        <form
          onSubmit={onSubmit}
          className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-3"
          noValidate
        >
          {/* 시작 시각·세션 길이·휴식·세션 횟수·생성/초기화 버튼·재생성 토글을 한 행에 배치(좁아지면 자동 줄바꿈). */}
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-72">
              <TextField
                label="시작 시각"
                type="datetime-local"
                error={errors.start_local?.message}
                {...register('start_local')}
              />
            </div>
            <div className="w-28">
              <TextField
                label="세션 길이(분)"
                type="number"
                min={1}
                max={600}
                error={errors.session_minutes?.message}
                {...register('session_minutes')}
              />
            </div>
            <div className="w-24">
              <TextField
                label="휴식(분)"
                type="number"
                min={0}
                max={600}
                error={errors.break_minutes?.message}
                {...register('break_minutes')}
              />
            </div>
            <div className="w-24">
              <TextField
                label="세션 횟수"
                type="number"
                min={1}
                max={50}
                error={errors.session_count?.message}
                {...register('session_count')}
              />
            </div>
            <SectionActionButton type="submit" tone="primary" loading={generate.isPending}>
              슬롯 생성
            </SectionActionButton>
            {emptyCount > 0 && (
              <SectionActionButton type="button" onClick={() => setShowClear(true)}>
                빈 슬롯 초기화
              </SectionActionButton>
            )}
          </div>

          {/* 식사 시간대(최대 3개, add 형태): 지정한 구간과 겹치는 세션은 구간 종료 이후로 밀린다. */}
          <div className="flex flex-col gap-2 rounded-lg border border-border bg-white p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-neutral-base">
                식사 시간{' '}
                <span className="font-medium text-neutral-base/70">
                  (선택 · 최대 {MAX_MEAL_WINDOWS}개)
                </span>
              </span>
              <SectionActionButton
                type="button"
                onClick={() => appendMeal({ start: '12:00', end: '13:00' })}
                disabled={mealFields.length >= MAX_MEAL_WINDOWS}
              >
                식사 시간 추가
              </SectionActionButton>
            </div>
            {mealFields.length === 0 ? (
              <p className="text-sm text-neutral-base/70">
                식사 시간을 추가하면 그 시간대와 겹치는 세션은 식사 이후로 밀립니다.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {mealFields.map((field, index) => (
                  <div key={field.id} className="flex flex-wrap items-end gap-3">
                    <div className="w-40">
                      <TextField
                        label={`식사 ${index + 1} 시작`}
                        type="time"
                        error={errors.meals?.[index]?.start?.message}
                        {...register(`meals.${index}.start` as const)}
                      />
                    </div>
                    <div className="w-40">
                      <TextField
                        label="종료"
                        type="time"
                        error={errors.meals?.[index]?.end?.message}
                        {...register(`meals.${index}.end` as const)}
                      />
                    </div>
                    <SectionActionButton type="button" onClick={() => removeMeal(index)}>
                      삭제
                    </SectionActionButton>
                  </div>
                ))}
              </div>
            )}
            {errors.meals?.message && (
              <p className="text-sm font-medium text-brand">{errors.meals.message}</p>
            )}
          </div>

          {/* 생성될 슬롯 정보(미리보기). */}
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
              {mealWindows.length > 0 && (
                <p className="text-sm text-neutral-base/70">
                  식사 시간{' '}
                  {mealWindows
                    .map(
                      (w) =>
                        `${formatDateTime(w.startIso, tz).slice(-5)}~${formatDateTime(w.endIso, tz).slice(-5)}`,
                    )
                    .join(', ')}{' '}
                  은(는) 세션에서 제외됩니다.
                </p>
              )}
              <div className="flex flex-wrap gap-1">
                {preview.track.slice(0, PREVIEW_LIMIT).map((t) => (
                  <Badge key={t.startIso} tone="muted" size="11">
                    {formatDateTime(t.startIso, tz).slice(-5)}
                  </Badge>
                ))}
                {preview.track.length > PREVIEW_LIMIT && (
                  <span className="px-1 py-0.5 text-xs text-neutral-base/50">
                    외 {preview.track.length - PREVIEW_LIMIT}개
                  </span>
                )}
              </div>
              {preview.exceedsEvent && (
                <Alert tone="info">
                  마지막 세션 종료가 행사 종료 시각을 넘습니다. 시간표를 확인해 주세요.
                </Alert>
              )}
            </div>
          )}

        </form>
      )}

      <ConfirmModal
        open={showClear}
        onClose={() => setShowClear(false)}
        title="빈 슬롯 초기화"
        message="예약되지 않은 빈 슬롯을 모두 삭제합니다. 예약·진행 중인 슬롯은 유지됩니다."
        confirmLabel="초기화"
        loading={clear.isPending}
        onConfirm={() => {
          clear.mutate(undefined, {
            onSuccess: (n) => {
              setShowClear(false);
              toast.success(`빈 슬롯 ${n}개를 삭제했습니다.`);
            },
            onError: (e) =>
              toast.error('빈 슬롯을 초기화하지 못했습니다.', { description: (e as Error).message }),
          });
        }}
      />
    </StatCardSection>
  );
}
