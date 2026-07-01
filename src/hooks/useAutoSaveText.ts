import { useEffect, useRef, useState } from 'react';

export type AutoSaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface UseAutoSaveTextOptions {
  /** 서버에 저장된 현재 값(조회 결과). 비어 있으면 ''. */
  initial: string;
  /** 값을 서버에 저장한다. 실패 시 reject 하면 상태가 'error' 로 전환된다. */
  onSave: (value: string) => Promise<void>;
  /** 입력이 멈춘 뒤 저장까지 대기(ms). 기본 700. */
  delay?: number;
  /** 저장 전 정규화(예: trim). 비교/저장 모두 이 값 기준. */
  transform?: (value: string) => string;
}

/**
 * 입력값을 디바운스로 자동 저장하는 폼 훅(저장 버튼 없음).
 * 마지막 저장값(savedRef)과 다를 때만 저장하고, 저장 성공/실패 상태를 노출한다.
 * 서버 값이 갱신되면(사용자가 편집 중이 아닐 때) 다시 시드한다(화면 간 공유·재조회 대응).
 */
export function useAutoSaveText({
  initial,
  onSave,
  delay = 700,
  transform = (v) => v,
}: UseAutoSaveTextOptions) {
  const [value, setValue] = useState(initial);
  const [status, setStatus] = useState<AutoSaveStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const savedRef = useRef(transform(initial));
  const valueRef = useRef(value);
  valueRef.current = value;
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const transformRef = useRef(transform);
  transformRef.current = transform;

  // 서버 값 갱신 시, 편집 중(=저장본과 다름)이 아니라면 다시 시드.
  useEffect(() => {
    if (transformRef.current(valueRef.current) === savedRef.current) {
      savedRef.current = transformRef.current(initial);
      setValue(initial);
    }
  }, [initial]);

  // 입력이 멈추면 디바운스 저장. 타이머 콜백에서 최신값을 재확인해 시드 전환 경합을 방지.
  useEffect(() => {
    if (transformRef.current(value) === savedRef.current) return;
    const timer = setTimeout(() => {
      const latest = transformRef.current(valueRef.current);
      if (latest === savedRef.current) return;
      void (async () => {
        setStatus('saving');
        setError(null);
        try {
          await onSaveRef.current(latest);
          savedRef.current = latest;
          setStatus('saved');
        } catch (e) {
          setStatus('error');
          setError((e as Error).message);
        }
      })();
    }, delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return { value, setValue, status, error };
}
