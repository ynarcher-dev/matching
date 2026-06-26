import { useMemo, useState } from 'react';
import { Card } from '@/components/common/Card';
import { Alert } from '@/components/common/Alert';
import { TextField } from '@/components/common/TextField';
import { CompanyPhotoUploadPanel } from '@/components/staff/CompanyPhotoUploadPanel';
import { useEventCompanyPhotos } from '@/hooks/useCompanyPhotos';
import {
  buildCompanyStatuses,
  filterCompanyStatuses,
  summarizePhotoStatus,
} from '@/lib/companyPhoto';
import { formatDateTime } from '@/lib/datetime';
import type { AssignableUser, EventParticipantRow } from '@/types/eventDetail';
import type { PhotoCompany } from '@/types/companyPhoto';

/**
 * 관리자 행사 상세 "사진 현황" 탭 (docs/staff_company_photo_upload.md §6).
 * 기업별 등록 현황(개수·마지막 업로드)·누락 기업·전체 요약을 제공하고,
 * 기업을 펼치면 사진 검수(조회/삭제)와 보완 업로드까지 할 수 있다(관리자도 is_admin_or_staff).
 */
export function PhotoStatusPanel({
  eventId,
  participants,
  userById,
  timezone,
}: {
  eventId: string;
  participants: EventParticipantRow[];
  userById: Map<string, AssignableUser>;
  timezone: string;
}) {
  const photosQ = useEventCompanyPhotos(eventId);
  const [query, setQuery] = useState('');
  const [openCompany, setOpenCompany] = useState<string | null>(null);

  const companies = useMemo<PhotoCompany[]>(
    () =>
      participants
        .filter((p) => p.participant_type === 'STARTUP')
        .map((p) => {
          const u = userById.get(p.user_id);
          return {
            userId: p.user_id,
            companyName: u?.company_name || u?.name || '(이름 미상)',
            contactName: u?.representative_name || u?.name || '',
          };
        }),
    [participants, userById],
  );

  const statuses = useMemo(
    () => buildCompanyStatuses(companies, photosQ.data ?? []),
    [companies, photosQ.data],
  );
  const summary = useMemo(() => summarizePhotoStatus(statuses), [statuses]);
  const filtered = useMemo(() => filterCompanyStatuses(statuses, query), [statuses, query]);

  const openPhotos = useMemo(
    () => (photosQ.data ?? []).filter((p) => p.company_user_id === openCompany),
    [photosQ.data, openCompany],
  );
  const openCompanyInfo = companies.find((c) => c.userId === openCompany) ?? null;

  return (
    <div className="flex flex-col gap-5">
      {/* 요약 지표 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard label="전체 기업" value={summary.totalCompanies} />
        <SummaryCard label="사진 있음" value={summary.withPhotos} tone="ok" />
        <SummaryCard label="사진 없음" value={summary.withoutPhotos} tone="warn" />
        <SummaryCard label="총 사진" value={summary.totalPhotos} />
      </div>

      {photosQ.isError && (
        <Alert tone="error">사진 현황을 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.</Alert>
      )}

      <Card className="p-4">
        <div className="mb-3 max-w-xs">
          <TextField
            label="기업 검색"
            placeholder="기업명 또는 담당자명"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {filtered.length === 0 ? (
          <p className="py-6 text-center text-sm text-neutral-base">
            {statuses.length === 0 ? '참가 기업이 없습니다.' : '검색 결과가 없습니다.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-neutral-base/70">
                  <th className="px-2 py-2 font-semibold">기업명</th>
                  <th className="px-2 py-2 font-semibold">담당자</th>
                  <th className="px-2 py-2 font-semibold">사진 수</th>
                  <th className="px-2 py-2 font-semibold">마지막 업로드</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr key={s.userId} className="border-b border-border/60">
                    <td className="px-2 py-2 font-medium text-neutral-base">{s.companyName}</td>
                    <td className="px-2 py-2 text-neutral-base/80">{s.contactName}</td>
                    <td className="px-2 py-2">
                      {s.photoCount > 0 ? (
                        <span className="font-semibold text-emerald-700">{s.photoCount}</span>
                      ) : (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                          미등록
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-neutral-base/80">
                      {s.lastUploadedAt ? formatDateTime(s.lastUploadedAt, timezone) : '-'}
                    </td>
                    <td className="px-2 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => setOpenCompany((cur) => (cur === s.userId ? null : s.userId))}
                        className="font-semibold text-brand underline hover:text-brand-hover"
                      >
                        {openCompany === s.userId ? '닫기' : '검수'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {openCompanyInfo && (
        <Card className="p-4">
          <CompanyPhotoUploadPanel
            eventId={eventId}
            company={openCompanyInfo}
            photos={openPhotos}
          />
        </Card>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'ok' | 'warn';
}) {
  const valueClass =
    tone === 'ok' ? 'text-emerald-700' : tone === 'warn' ? 'text-amber-700' : 'text-neutral-base';
  return (
    <Card className="p-3">
      <p className="text-xs text-neutral-base/70">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${valueClass}`}>{value}</p>
    </Card>
  );
}
