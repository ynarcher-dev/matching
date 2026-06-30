import { useMemo, useState, type KeyboardEvent } from 'react';
import { useCreateField, useFields } from '@/hooks/useFields';
import { Badge } from '@/components/common/Badge';

interface FieldTagInputProps {
  /** 선택된 field_id 목록. */
  value: string[];
  onChange: (next: string[]) => void;
  /** 최대 개수(기본 3). */
  max?: number;
  /** 검증 오류 메시지. */
  error?: string;
}

/**
 * 관심/전문 분야 해시태그 작성 입력 (사용자 요청 2026-06-29 — 고르기→작성).
 * 텍스트를 입력해 Enter/콤마로 태그를 추가한다. 기존 분야명(대소문자 무시)은 재사용하고,
 * 없으면 fields 마스터에 자동 등록(find-or-create)해 매칭·배정과 계속 연동된다(최대 max).
 * 폼 값은 기존과 동일하게 field_id 목록을 유지한다(스키마·저장 로직 무변경).
 */
export function FieldTagInput({ value, onChange, max = 3, error }: FieldTagInputProps) {
  const { data: fields, isLoading, isError } = useFields();
  const createField = useCreateField();
  const [input, setInput] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const nameById = useMemo(
    () => new Map((fields ?? []).map((f) => [f.id, f.name])),
    [fields],
  );
  const idByLowerName = useMemo(
    () => new Map((fields ?? []).map((f) => [f.name.toLowerCase(), f.id])),
    [fields],
  );

  const atMax = value.length >= max;

  const remove = (id: string) => onChange(value.filter((v) => v !== id));

  const commit = async () => {
    if (createField.isPending) return;
    const raw = input.trim().replace(/^#+/, '').trim();
    setLocalError(null);
    if (!raw) return;
    if (raw.length > 100) {
      setLocalError('분야명은 100자 이하여야 합니다.');
      return;
    }
    if (atMax) {
      setLocalError(`분야는 최대 ${max}개까지 작성할 수 있습니다.`);
      return;
    }

    // 1) 기존 분야(대소문자 무시) 재사용.
    const existingId = idByLowerName.get(raw.toLowerCase());
    if (existingId) {
      if (!value.includes(existingId)) onChange([...value, existingId]);
      setInput('');
      return;
    }

    // 2) 없으면 마스터에 자동 등록 후 연결.
    try {
      const field = await createField.mutateAsync(raw);
      if (!value.includes(field.id)) onChange([...value, field.id]);
      setInput('');
    } catch (e) {
      setLocalError((e as Error).message);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      void commit();
    } else if (e.key === 'Backspace' && input === '' && value.length > 0) {
      remove(value[value.length - 1]);
    }
  };

  const message = localError ?? (isError ? '분야 목록을 불러오지 못했습니다.' : error);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-neutral-base">관심/전문 분야</span>
        <span className="text-xs text-neutral-base/60">
          {value.length}/{max}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-surface-raised px-2 py-1.5 focus-within:border-brand">
        {value.map((id) => (
          <Badge
            key={id}
            tone="brand"
            className="shrink-0"
          >
            {nameById.get(id) ?? '…'}
            <button
              type="button"
              onClick={() => remove(id)}
              aria-label={`${nameById.get(id) ?? '분야'} 제거`}
              className="ml-0.5 leading-none opacity-60 hover:opacity-100"
            >
              ×
            </button>
          </Badge>
        ))}
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={isLoading || atMax}
          list="field-tag-suggestions"
          placeholder={
            atMax
              ? `최대 ${max}개까지`
              : value.length === 0
                ? '예: 인공지능 (입력 후 Enter)'
                : '추가…'
          }
          className="min-w-[8rem] flex-1 bg-transparent px-1 py-0.5 text-sm text-neutral-base outline-none placeholder:text-neutral-base/40 disabled:cursor-not-allowed"
        />
        <datalist id="field-tag-suggestions">
          {(fields ?? []).map((f) => (
            <option key={f.id} value={f.name} />
          ))}
        </datalist>
      </div>
      <p className="text-xs text-neutral-base/50">
        해시태그처럼 작성해 Enter 로 추가하세요. 기존 분야명은 자동완성·재사용됩니다.
      </p>
      {message && <p className="text-sm font-medium text-brand">{message}</p>}
    </div>
  );
}
