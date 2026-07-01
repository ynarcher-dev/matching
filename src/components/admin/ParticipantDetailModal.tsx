import { Modal } from '@/components/common/Modal';
import { Button } from '@/components/common/Button';
import { Badge } from '@/components/common/Badge';
import { FileCell } from '@/components/admin/participantCells';
import { ExpertAvatarView } from '@/components/admin/ExpertAvatarField';
import { participantLabel, PARTICIPANT_ROLE_LABELS } from '@/lib/labels';
import type { AssignableUser } from '@/types/eventDetail';

interface ParticipantDetailModalProps {
  open: boolean;
  onClose: () => void;
  user: AssignableUser | null;
  /** field_id → 분야명. */
  fieldNameById: Map<string, string>;
}

/**
 * 참가 스타트업/전문가 상세 모달 (행 클릭 진입).
 * 기본정보·분야·소개를 읽기로 보여주고, 스타트업은 이 화면에서도 IR/소개서를 업로드·교체·해제한다
 * (관리자 대행 — DB 화면·스타트업 본인 업로드와 동일 경로).
 */
export function ParticipantDetailModal({
  open,
  onClose,
  user,
  fieldNameById,
}: ParticipantDetailModalProps) {
  const isExpert = user?.role === 'EXPERT';

  if (!user) return null;

  const fieldNames = user.field_ids.map((id) => fieldNameById.get(id)).filter(Boolean) as string[];
  const description = isExpert ? user.expert_description : user.company_description;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={participantLabel(user)}
      footer={
        <Button variant="outline" onClick={onClose}>
          닫기
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        {/* 전문가는 사진(좌) + 정보(우) 가로 배치, 좁은 화면에서는 세로로 쌓는다. */}
        <div className={isExpert ? 'flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-5' : ''}>
          {isExpert && (
            <div className="flex shrink-0 justify-center sm:justify-start">
              <ExpertAvatarView path={user.profile_image_url} />
            </div>
          )}

          <div
            className={`grid grid-cols-[5rem_1fr] gap-x-3 gap-y-2 text-sm${
              isExpert ? ' min-w-0 flex-1' : ''
            }`}
          >
          <Field label="구분" value={PARTICIPANT_ROLE_LABELS[user.role]} />
          {isExpert ? (
            <>
              <Field label="이름" value={user.name} />
              <Field label="소속" value={user.expert_organization} />
              <Field label="직책" value={user.expert_position} />
            </>
          ) : (
            <>
              <Field label="기업명" value={user.company_name} />
              <Field label="대표자명" value={user.representative_name} />
              <Field label="담당자명" value={user.contact_name} />
              <LinkField label="홈페이지" value={user.company_homepage} />
            </>
          )}
          <Field label="이메일" value={user.email} />
          <Field label="연락처" value={user.phone_number} />
          <div className="text-neutral-base/60">분야</div>
          <div>
            {fieldNames.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {fieldNames.map((n) => (
                  <Badge key={n} tone="brand">
                    {n}
                  </Badge>
                ))}
              </div>
            ) : (
              <span className="text-neutral-base/40">-</span>
            )}
          </div>
          <div className="text-neutral-base/60">소개</div>
          <p className="whitespace-pre-wrap break-words text-neutral-base/90">
            {description || <span className="text-neutral-base/40">-</span>}
          </p>
          </div>
        </div>

        {/* 스타트업 IR/소개서: 읽기 전용으로 다운로드/조회만 허용 */}
        {!isExpert && (
          <div className="flex flex-col gap-2 border-t border-border pt-4 text-sm">
            <div className="text-neutral-base/60 font-semibold">사업소개서</div>
            <div className="flex items-center gap-2">
              {user.proposal_file_url ? (
                <FileCell path={user.proposal_file_url} label="소개서 다운로드 / 보기" active={false} />
              ) : (
                <span className="text-neutral-base/40">등록된 소개서 없음</span>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <>
      <div className="text-neutral-base/60">{label}</div>
      <div className="break-words text-neutral-base/90">
        {value || <span className="text-neutral-base/40">-</span>}
      </div>
    </>
  );
}

/** 홈페이지 등 외부 URL 필드. 값이 있으면 새 탭 링크로, 없으면 '-'. */
function LinkField({ label, value }: { label: string; value: string | null }) {
  const href = value ? (/^https?:\/\//i.test(value) ? value : `https://${value}`) : null;
  return (
    <>
      <div className="text-neutral-base/60">{label}</div>
      <div className="break-words text-neutral-base/90">
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-info underline underline-offset-2 hover:opacity-80"
          >
            {value}
          </a>
        ) : (
          <span className="text-neutral-base/40">-</span>
        )}
      </div>
    </>
  );
}
