import { useEffect, useState } from 'react';

/**
 * 값 변경을 지정 지연(ms) 후에 반영하는 디바운스 훅.
 * 큰 데이터셋 검색에서 매 키 입력마다 재필터링되는 것을 방지한다(8-C 검색 표준화).
 */
export function useDebouncedValue<T>(value: T, delayMs = 200): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);

  return debounced;
}
