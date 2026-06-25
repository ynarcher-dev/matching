/** 로그인 역할 선택 탭 (page_auth_layout.md §1.2). */
export type LoginTab = 'STARTUP' | 'EXPERT' | 'OPERATOR';

const TABS: { key: LoginTab; label: string }[] = [
  { key: 'STARTUP', label: '참가 스타트업' },
  { key: 'EXPERT', label: '전문가/자문위원' },
  { key: 'OPERATOR', label: '운영진' },
];

interface RoleTabsProps {
  active: LoginTab;
  onChange: (tab: LoginTab) => void;
}

/**
 * 세그먼트 컨트롤 (page_auth_layout.md §2.1): 굵은 칸막이 대신 연회색 컨테이너 안에서
 * 선택된 항목의 배경(흰색)·글자색(브랜드)만 전환한다.
 */
export function RoleTabs({ active, onChange }: RoleTabsProps) {
  return (
    <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1" role="tablist">
      {TABS.map((tab) => {
        const selected = tab.key === active;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(tab.key)}
            className={`rounded-md px-2 py-2 text-sm font-semibold transition-colors ${
              selected
                ? 'bg-white text-brand shadow-sm'
                : 'bg-transparent text-neutral-base hover:text-brand'
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
