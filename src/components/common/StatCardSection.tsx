import type { ReactNode } from 'react';
import { Card } from '@/components/common/Card';

/**
 * 통계 카드 섹션(관리자 행사 상세 탭 공통).
 * 제목(+선택 설명) · 우측 액션 슬롯 · 하단 지표 그리드(children)로
 * 예약·진행·상담일지·만족도·운영·알림·참가자 탭 상단 요약 카드를 하나의 레이아웃으로 통일한다.
 * 지표 박스는 공통 StatBox 를 쓰고, grid 컬럼 수만 탭별로 children 에서 정한다.
 */
export function StatCardSection({
  title,
  description,
  actions,
  children,
}: {
  title: ReactNode;
  /** 제목 아래 보조 설명(결과/집계 안내). 없으면 제목만. */
  description?: ReactNode;
  /** 우측 상단 액션(설정·CSV·강제배치 버튼 또는 자동 갱신 안내 등). */
  actions?: ReactNode;
  /** 지표 그리드(StatBox grid). 필요 시 상단 에러/빈 상태도 함께 넣는다. */
  children: ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-5 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-bold text-neutral-base">{title}</h2>
          {description && <p className="text-sm text-neutral-base/70">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </Card>
  );
}
