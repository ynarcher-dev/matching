import { useMemo, useState } from 'react';
import { TextField } from '@/components/common/TextField';
import { filterCompanyStatuses } from '@/lib/companyPhoto';
import type { CompanyPhotoStatus } from '@/types/companyPhoto';

/**
 * 현장담당자 기업 목록(검색 + 사진 개수 배지). 모바일 우선 세로 리스트.
 * 사진 0장 기업은 "미등록" 배지로 강조해 누락을 빠르게 찾게 한다.
 */
export function CompanyPhotoList({
  statuses,
  selectedId,
  onSelect,
}: {
  statuses: CompanyPhotoStatus[];
  selectedId: string | null;
  onSelect: (companyUserId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => filterCompanyStatuses(statuses, query), [statuses, query]);

  return (
    <div className="flex flex-col gap-3">
      <TextField
        label="기업 검색"
        placeholder="기업명 또는 담당자명"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {filtered.length === 0 ? (
        <p className="px-1 py-6 text-center text-sm text-neutral-base">
          {statuses.length === 0 ? '참가 기업이 없습니다.' : '검색 결과가 없습니다.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {filtered.map((c) => {
            const active = c.userId === selectedId;
            return (
              <li key={c.userId}>
                <button
                  type="button"
                  onClick={() => onSelect(c.userId)}
                  className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                    active
                      ? 'border-brand bg-brand/5'
                      : 'border-border bg-white hover:bg-surface'
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-neutral-base">
                      {c.companyName}
                    </span>
                    <span className="block truncate text-xs text-neutral-base/70">
                      {c.contactName}
                    </span>
                  </span>
                  {c.photoCount > 0 ? (
                    <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                      사진 {c.photoCount}
                    </span>
                  ) : (
                    <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                      미등록
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
