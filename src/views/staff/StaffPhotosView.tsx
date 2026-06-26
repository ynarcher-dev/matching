import { useMemo, useState } from 'react';
import { Card } from '@/components/common/Card';
import { Alert } from '@/components/common/Alert';
import { SelectField } from '@/components/common/SelectField';
import { FullScreenLoader } from '@/components/common/FullScreenLoader';
import { CompanyPhotoList } from '@/components/staff/CompanyPhotoList';
import { CompanyPhotoUploadPanel } from '@/components/staff/CompanyPhotoUploadPanel';
import { useEvents } from '@/hooks/useEvents';
import { useEventParticipants, useAssignableUsers } from '@/hooks/useEventDetail';
import { useEventCompanyPhotos } from '@/hooks/useCompanyPhotos';
import { buildCompanyStatuses } from '@/lib/companyPhoto';
import type { PhotoCompany } from '@/types/companyPhoto';

/**
 * 현장담당자 기업별 사진 업로드 (docs/staff_company_photo_upload.md §2).
 * 모바일 우선: 행사 선택 → 기업 검색/선택 → 카메라 촬영/선택 → 일괄 업로드.
 * STAFF/ADMIN operator 클라이언트. 권한은 RLS(0036)가 게이트한다.
 */
export function StaffPhotosView() {
  const eventsQ = useEvents();
  const [eventId, setEventId] = useState('');
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);

  // 취소된 행사는 제외. 기본 선택 = 첫 행사.
  const events = useMemo(
    () => (eventsQ.data ?? []).filter((e) => e.status !== 'CANCELLED'),
    [eventsQ.data],
  );
  const activeEventId = eventId || events[0]?.id || '';

  const participantsQ = useEventParticipants(activeEventId);
  const usersQ = useAssignableUsers();
  const photosQ = useEventCompanyPhotos(activeEventId);

  const companies = useMemo<PhotoCompany[]>(() => {
    const userById = new Map((usersQ.data ?? []).map((u) => [u.id, u]));
    return (participantsQ.data ?? [])
      .filter((p) => p.participant_type === 'STARTUP')
      .map((p) => {
        const u = userById.get(p.user_id);
        return {
          userId: p.user_id,
          companyName: u?.company_name || u?.name || '(이름 미상)',
          contactName: u?.representative_name || u?.name || '',
        };
      });
  }, [participantsQ.data, usersQ.data]);

  const statuses = useMemo(
    () => buildCompanyStatuses(companies, photosQ.data ?? []),
    [companies, photosQ.data],
  );

  const selected = selectedCompany
    ? statuses.find((s) => s.userId === selectedCompany) ?? null
    : null;
  const selectedPhotos = useMemo(
    () => (photosQ.data ?? []).filter((p) => p.company_user_id === selectedCompany),
    [photosQ.data, selectedCompany],
  );

  if (eventsQ.isLoading) return <FullScreenLoader />;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-bold text-neutral-base">현장 사진 업로드</h1>
        <p className="mt-1 text-sm text-neutral-base/70">
          행사와 기업을 선택해 현장 사진을 촬영하거나 앨범에서 선택해 업로드합니다.
        </p>
      </div>

      {events.length === 0 ? (
        <Card className="p-6">
          <Alert tone="info">진행 가능한 행사가 없습니다.</Alert>
        </Card>
      ) : (
        <>
          <Card className="p-4">
            <SelectField
              label="행사 선택"
              value={activeEventId}
              onChange={(e) => {
                setEventId(e.target.value);
                setSelectedCompany(null);
              }}
              options={events.map((e) => ({ value: e.id, label: e.title }))}
            />
          </Card>

          {(participantsQ.isError || usersQ.isError || photosQ.isError) && (
            <Alert tone="error">데이터를 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.</Alert>
          )}

          <div className="grid gap-5 lg:grid-cols-[minmax(0,20rem)_1fr]">
            <Card className="p-4">
              <CompanyPhotoList
                statuses={statuses}
                selectedId={selectedCompany}
                onSelect={setSelectedCompany}
              />
            </Card>

            <Card className="p-4">
              {selected ? (
                <CompanyPhotoUploadPanel
                  eventId={activeEventId}
                  company={selected}
                  photos={selectedPhotos}
                />
              ) : (
                <p className="px-1 py-10 text-center text-sm text-neutral-base">
                  왼쪽에서 기업을 선택하면 사진을 업로드할 수 있습니다.
                </p>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
