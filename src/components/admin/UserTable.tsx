import { useState } from 'react';
import { formatDateTime } from '@/lib/datetime';
import { CHANNEL_LABELS, OTP_STATUS_LABELS } from '@/lib/labels';
import { createParticipantSignedUrl } from '@/lib/storage';
import type { OtpStatus, ParticipantRole, ParticipantWithAuth } from '@/types/user';

interface UserTableProps {
  users: ParticipantWithAuth[];
  role: ParticipantRole;
  /** field_id → 분야명 매핑(분야 칩 표시용). */
  fieldNameById: Map<string, string>;
  onEdit: (user: ParticipantWithAuth) => void;
  onDelete: (user: ParticipantWithAuth) => void;
  onInvalidate: (user: ParticipantWithAuth) => void;
  onIssueLink: (user: ParticipantWithAuth) => void;
}

/** 관리자 표시 기준 타임존(운영본부는 KST 기준으로 본다). */
const DISPLAY_TZ = 'Asia/Seoul';

/** OTP 상태별 배지 색상. */
const STATUS_TONE: Record<OtpStatus, string> = {
  USED: 'bg-muted text-neutral-base',
  SENT: 'bg-info-surface text-neutral-base',
  EXPIRED: 'bg-surface text-neutral-base/70',
  INVALIDATED: 'bg-danger-surface text-brand',
  NONE: 'bg-surface text-neutral-base/60',
};

/**
 * 참가자 테이블 (page_admin_user_management.md §1.2, §3 모바일 가로 스크롤).
 * 역할별 전용 컬럼 + 인증 채널/최근 OTP 상태 + 조작(수정·삭제·세션무효화·1회용 링크).
 */
export function UserTable({
  users,
  role,
  fieldNameById,
  onEdit,
  onDelete,
  onInvalidate,
  onIssueLink,
}: UserTableProps) {
  const isStartup = role === 'STARTUP';
  const fileHeader = isStartup ? '소개서' : '프로필';

  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[1080px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-border bg-surface text-neutral-base/80">
            <Th>이름</Th>
            {isStartup ? (
              <>
                <Th>기업명</Th>
                <Th>대표자명</Th>
              </>
            ) : (
              <>
                <Th>소속</Th>
                <Th>직책</Th>
              </>
            )}
            <Th>이메일</Th>
            <Th>연락처</Th>
            <Th>분야</Th>
            <Th>{fileHeader}</Th>
            <Th>인증 채널</Th>
            <Th>최근 OTP</Th>
            <Th>등록일</Th>
            <Th>조작</Th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className="border-b border-border last:border-b-0 hover:bg-surface/60">
              <Td className="font-semibold text-neutral-base">{u.name}</Td>
              {isStartup ? (
                <>
                  <Td>{u.company_name ?? '-'}</Td>
                  <Td>{u.representative_name ?? '-'}</Td>
                </>
              ) : (
                <>
                  <Td>{u.expert_organization ?? '-'}</Td>
                  <Td>{u.expert_position ?? '-'}</Td>
                </>
              )}
              <Td className="text-neutral-base/80">{u.email}</Td>
              <Td>{u.phone_number || '-'}</Td>
              <Td>
                <FieldsCell ids={u.field_ids} nameById={fieldNameById} />
              </Td>
              <Td>
                <FileCell path={isStartup ? u.proposal_file_url : u.profile_image_url} />
              </Td>
              <Td>
                <ChannelCell user={u} />
              </Td>
              <Td>
                <OtpCell user={u} />
              </Td>
              <Td className="whitespace-nowrap text-neutral-base/70">
                {formatDateTime(u.created_at, DISPLAY_TZ)}
              </Td>
              <Td>
                <div className="flex flex-wrap gap-1.5">
                  <RowAction onClick={() => onEdit(u)}>수정</RowAction>
                  <RowAction onClick={() => onIssueLink(u)}>링크</RowAction>
                  <RowAction onClick={() => onInvalidate(u)}>세션무효화</RowAction>
                  <RowAction danger onClick={() => onDelete(u)}>
                    삭제
                  </RowAction>
                </div>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 인증 가능 채널 표시. 채널이 없으면 경고색으로 노출(발송 불가 필터 대상). */
function ChannelCell({ user }: { user: ParticipantWithAuth }) {
  if (user.channels.length === 0) {
    return <span className="font-medium text-brand">연락처 없음</span>;
  }
  return (
    <span className="whitespace-nowrap text-neutral-base/80">
      {user.channels.map((c) => CHANNEL_LABELS[c]).join(' · ')}
    </span>
  );
}

/** 최근 OTP 발송 상태 배지 + 긴급 링크 활성 표시. */
function OtpCell({ user }: { user: ParticipantWithAuth }) {
  const status: OtpStatus = user.auth?.otp_status ?? 'NONE';
  const channel = user.auth?.otp_channel;
  return (
    <div className="flex flex-col items-start gap-1">
      <span
        className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_TONE[status]}`}
      >
        {OTP_STATUS_LABELS[status]}
        {channel ? ` · ${CHANNEL_LABELS[channel]}` : ''}
      </span>
      {user.auth?.has_active_emergency && (
        <span className="text-xs font-medium text-brand">링크 활성</span>
      )}
    </div>
  );
}

/** 분야 칩(이름 매핑). 비어 있으면 '-'. */
function FieldsCell({ ids, nameById }: { ids: string[]; nameById: Map<string, string> }) {
  if (ids.length === 0) return <span className="text-neutral-base/50">-</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {ids.map((id) => (
        <span
          key={id}
          className="whitespace-nowrap rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-neutral-base"
        >
          {nameById.get(id) ?? '알 수 없음'}
        </span>
      ))}
    </div>
  );
}

/** 첨부 파일 보기(클릭 시 단기 Signed URL 발급 후 새 탭). 없으면 '-'. */
function FileCell({ path }: { path: string | null }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  if (!path) return <span className="text-neutral-base/50">-</span>;

  const open = async () => {
    setError(false);
    setLoading(true);
    try {
      const url = await createParticipantSignedUrl(path, 120);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={open}
      disabled={loading}
      className={`whitespace-nowrap rounded-md border border-border px-2 py-1 text-xs font-semibold transition-colors ${
        error ? 'text-brand' : 'text-neutral-base'
      } hover:bg-surface disabled:opacity-50`}
    >
      {loading ? '여는 중…' : error ? '오류 · 재시도' : '보기'}
    </button>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="whitespace-nowrap px-3 py-2.5 font-semibold">{children}</th>;
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2.5 align-middle ${className}`}>{children}</td>;
}

function RowAction({
  children,
  onClick,
  danger = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`whitespace-nowrap rounded-md border px-2 py-1 text-xs font-semibold transition-colors ${
        danger
          ? 'border-border text-brand hover:bg-danger-surface'
          : 'border-border text-neutral-base hover:bg-surface'
      }`}
    >
      {children}
    </button>
  );
}
