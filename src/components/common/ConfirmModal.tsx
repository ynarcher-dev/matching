import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Modal } from '@/components/common/Modal';
import { Button } from '@/components/common/Button';
import { Alert } from '@/components/common/Alert';

interface ConfirmModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** 본문 안내(설명 텍스트 또는 임의 노드). */
  message: ReactNode;
  confirmLabel?: string;
  /** 확정 시 호출. requireReason 이면 trim 된 사유가 전달된다. */
  onConfirm: (reason: string) => void;
  loading?: boolean;
  /** 진행 중 오류 메시지(있으면 상단에 표시). */
  error?: string | null;
  /** 사유 입력을 필수로 받는다(세션 무효화·링크 발급 등). */
  requireReason?: boolean;
  reasonLabel?: string;
  reasonPlaceholder?: string;
}

/**
 * 공통 확인 모달 (page_admin_user_management.md §1.2 조작 컬럼 — 삭제/세션 무효화/링크 발급).
 * 단순 확인은 message 만, 감사 사유가 필요한 액션은 requireReason 으로 사유 입력을 받는다.
 */
export function ConfirmModal({
  open,
  onClose,
  title,
  message,
  confirmLabel = '확인',
  onConfirm,
  loading = false,
  error,
  requireReason = false,
  reasonLabel = '사유',
  reasonPlaceholder = '사유를 입력해 주세요.',
}: ConfirmModalProps) {
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (open) {
      setReason('');
      setTouched(false);
    }
  }, [open]);

  const reasonInvalid = requireReason && reason.trim().length === 0;

  const handleConfirm = () => {
    if (reasonInvalid) {
      setTouched(true);
      return;
    }
    onConfirm(reason.trim());
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="md"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            취소
          </Button>
          <Button onClick={handleConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {error && <Alert tone="error">{error}</Alert>}
        <div className="text-sm text-neutral-base">{message}</div>
        {requireReason && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="confirm-reason" className="text-sm font-semibold text-neutral-base">
              {reasonLabel}
            </label>
            <textarea
              id="confirm-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              onBlur={() => setTouched(true)}
              rows={3}
              placeholder={reasonPlaceholder}
              className={`w-full rounded-lg border bg-white px-3 py-2 text-base text-neutral-base outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/30 ${
                touched && reasonInvalid ? 'border-brand' : 'border-border'
              }`}
            />
            {touched && reasonInvalid && (
              <p className="text-sm font-medium text-brand">사유를 입력해 주세요.</p>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
