import { Badge } from '@/components/common/Badge';
import type { OperatorPermission } from '@/types/operator';
import { OPERATOR_PERMISSION_LABELS } from '@/lib/labels';
import type { Tone } from '@/lib/tone';

/** 권한 등급별 의미 tone (9-A: 직접 색 대신 tone 공유). */
const PERMISSION_TONE: Record<OperatorPermission, Tone> = {
  OWNER: 'brand',
  MANAGER: 'info',
  STAFF: 'neutral',
  VIEWER: 'muted',
};

interface EventPermissionBadgeProps {
  permission: OperatorPermission;
  /** 최고관리자(전 행사 OWNER 상당)임을 함께 표기. */
  isSuper?: boolean;
}

/**
 * 행사 카드/상세에 표시하는 "내 권한" 배지 (page_admin_operator_permissions.md §5.2).
 * 9-B: 공통 Badge 로 마크업 통일.
 */
export function EventPermissionBadge({ permission, isSuper = false }: EventPermissionBadgeProps) {
  return (
    <Badge tone={PERMISSION_TONE[permission]} size="11">
      {isSuper ? '최고관리자' : OPERATOR_PERMISSION_LABELS[permission]}
    </Badge>
  );
}
