import { useEffect, useState } from 'react';
import { Modal } from '@/components/common/Modal';
import { Button } from '@/components/common/Button';
import { Alert } from '@/components/common/Alert';
import { useIssueEmergencyToken } from '@/hooks/useUserMutations';
import type { ParticipantWithAuth } from '@/types/user';

interface EmergencyLinkModalProps {
  open: boolean;
  onClose: () => void;
  user: ParticipantWithAuth | null;
}

/** 발급된 평문 토큰으로 현장 로그인 링크를 구성한다(서버는 해시만 보관). */
function buildLoginUrl(token: string): string {
  return `${window.location.origin}/login/emergency?token=${encodeURIComponent(token)}`;
}

/**
 * 1회용 로그인 링크 발급 모달 (page_admin_user_management.md §2.3).
 * 본인 확인 후 사유와 함께 발급한다. 발급된 링크는 1회만 표시되며 서버에 평문을 남기지 않는다.
 */
export function EmergencyLinkModal({ open, onClose, user }: EmergencyLinkModalProps) {
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const issue = useIssueEmergencyToken();

  useEffect(() => {
    if (open) {
      setReason('');
      setTouched(false);
      setLink(null);
      setCopied(false);
      issue.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!user) return null;

  const reasonInvalid = reason.trim().length === 0;

  const onIssue = () => {
    if (reasonInvalid) {
      setTouched(true);
      return;
    }
    issue.mutate(
      { id: user.id, reason: reason.trim() },
      {
        onSuccess: (data) => {
          if (data?.token) setLink(buildLoginUrl(data.token));
        },
      },
    );
  };

  const onCopy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="1회용 로그인 링크 발급"
      size="md"
      footer={
        link ? (
          <Button onClick={onClose}>완료</Button>
        ) : (
          <>
            <Button variant="outline" onClick={onClose} disabled={issue.isPending}>
              취소
            </Button>
            <Button onClick={onIssue} loading={issue.isPending}>
              발급
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm text-neutral-base">
          <span className="font-semibold">{user.name}</span> 님에게 발급할 현장 예외용 1회용
          로그인 링크입니다. 본인 확인 후 발급하세요.
        </p>

        {!link ? (
          <>
            {issue.isError && <Alert tone="error">{(issue.error as Error).message}</Alert>}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="emergency-reason" className="text-sm font-semibold text-neutral-base">
                발급 사유
              </label>
              <textarea
                id="emergency-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                onBlur={() => setTouched(true)}
                rows={3}
                placeholder="예: 등록 연락처 변경으로 OTP 수신 불가, 현장 본인 확인 완료"
                className={`w-full rounded-lg border bg-white px-3 py-2 text-base text-neutral-base outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/30 ${
                  touched && reasonInvalid ? 'border-brand' : 'border-border'
                }`}
              />
              {touched && reasonInvalid && (
                <p className="text-sm font-medium text-brand">발급 사유를 입력해 주세요.</p>
              )}
            </div>
          </>
        ) : (
          <>
            <Alert tone="success">
              링크가 발급되었습니다. 이 화면을 닫으면 다시 볼 수 없으니 지금 전달하세요(기본 30분 후
              만료).
            </Alert>
            <div className="flex flex-col gap-2">
              <textarea
                readOnly
                value={link}
                rows={3}
                className="w-full break-all rounded-lg border border-border bg-surface px-3 py-2 text-sm text-neutral-base outline-none"
              />
              <Button variant="outline" onClick={onCopy}>
                {copied ? '복사됨' : '링크 복사'}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
