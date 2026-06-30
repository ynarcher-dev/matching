import { useState } from 'react';
import { Badge } from '@/components/common/Badge';
import { Button } from '@/components/common/Button';
import { formatDateTime } from '@/lib/datetime';
import { createParticipantSignedUrl } from '@/lib/storage';
import { useProposalHistory } from '@/hooks/useProposalHistory';
import type { ProposalUploadAction } from '@/types/user';

/** 관리자 표시 기준 타임존. */
const DISPLAY_TZ = 'Asia/Seoul';

/** 액션별 라벨/배지 tone. */
const ACTION_META: Record<ProposalUploadAction, { label: string; tone: 'info' | 'neutral' | 'danger' }> = {
  UPLOAD: { label: '최초 업로드', tone: 'info' },
  REPLACE: { label: '교체', tone: 'neutral' },
  CLEAR: { label: '해제', tone: 'danger' },
};

/** 바이트 → 사람이 읽는 크기. 모르면 빈 문자열. */
function formatSize(bytes: number | null): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes}B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)}KB`;
  return `${(kb / 1024).toFixed(1)}MB`;
}

interface ProposalHistoryTimelineProps {
  /** 이력을 볼 스타트업 user_id. */
  userId: string;
}

/**
 * 스타트업 소개서 업로드 이력 타임라인 (사용자 요청 2026-06-29, 0052).
 * 언제·누가·어떤 파일(파일명/크기)을 올렸는지 최신순으로 보여주고, 과거 버전도 '보기'로 연다.
 * 최신본만 노출하던 기존 동작을 보완 — 변경 이력을 한곳에서 종합 관리한다.
 */
export function ProposalHistoryTimeline({ userId }: ProposalHistoryTimelineProps) {
  const { data, isLoading, isError } = useProposalHistory(userId);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = async (id: string, path: string) => {
    setError(null);
    setOpeningId(id);
    try {
      const url = await createParticipantSignedUrl(path, 120);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOpeningId(null);
    }
  };

  return (
    <section className="flex flex-col gap-2 rounded-lg border border-border p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-neutral-base">소개서 변경 이력</h3>
        {data && data.length > 0 && (
          <span className="text-xs text-neutral-base/50">{data.length}건</span>
        )}
      </div>

      {isLoading && <p className="text-sm text-neutral-base/60">이력을 불러오는 중…</p>}
      {isError && <p className="text-sm font-medium text-brand">이력을 불러오지 못했습니다.</p>}
      {!isLoading && !isError && (!data || data.length === 0) && (
        <p className="text-sm text-neutral-base/60">아직 업로드 이력이 없습니다.</p>
      )}

      {data && data.length > 0 && (
        <ol className="flex flex-col">
          {data.map((h, i) => {
            const meta = ACTION_META[h.action];
            const isLast = i === data.length - 1;
            const size = formatSize(h.file_size);
            return (
              <li key={h.id} className="flex gap-3">
                {/* 타임라인 점 + 세로줄 */}
                <div className="flex flex-col items-center">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand" />
                  {!isLast && <span className="w-px flex-1 bg-border" />}
                </div>
                <div className={`flex flex-1 flex-col gap-0.5 ${isLast ? '' : 'pb-3'}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={meta.tone}>
                      {meta.label}
                    </Badge>
                    <span className="text-xs text-neutral-base/70">
                      {formatDateTime(h.uploaded_at, DISPLAY_TZ)}
                    </span>
                    <span className="text-xs text-neutral-base/50">
                      · {h.uploader_name ?? '확인 불가'}
                    </span>
                  </div>
                  {h.action !== 'CLEAR' && (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm text-neutral-base">
                        {h.file_name ?? '파일명 미상'}
                        {size && (
                          <span className="text-xs text-neutral-base/50"> ({size})</span>
                        )}
                      </span>
                      {h.file_path && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => open(h.id, h.file_path as string)}
                          disabled={openingId === h.id}
                          className="whitespace-nowrap text-neutral-base"
                        >
                          {openingId === h.id ? '여는 중…' : '보기'}
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {error && <p className="text-sm font-medium text-brand">{error}</p>}
    </section>
  );
}
