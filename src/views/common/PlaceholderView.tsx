import { Card } from '@/components/common/Card';

/**
 * Phase 3 레이아웃 검증용 자리표시 페이지.
 * 각 역할의 실제 화면은 Phase 4~6 에서 이 자리에 구현된다.
 */
export function PlaceholderView({ title, description }: { title: string; description: string }) {
  return (
    <Card className="p-6">
      <h1 className="text-xl font-bold text-neutral-base">{title}</h1>
      <p className="mt-2 text-sm text-neutral-base">{description}</p>
      <span className="mt-4 inline-block rounded-md bg-brand px-3 py-1 text-sm font-semibold text-white">
        준비 중 — 다음 Phase 에서 구현
      </span>
    </Card>
  );
}
