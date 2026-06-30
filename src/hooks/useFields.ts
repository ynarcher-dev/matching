import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import type { Field } from '@/types/user';

/**
 * 분야 마스터 목록 조회 (docs/db_schema.md §2.3, fields_select RLS).
 * 관심/전문 분야 선택지와 id→name 매핑에 쓴다. 변동이 드물어 staleTime 을 길게 둔다.
 */
export const fieldKeys = {
  all: ['fields'] as const,
};

export function useFields() {
  return useQuery<Field[]>({
    queryKey: fieldKeys.all,
    staleTime: 1000 * 60 * 10,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('fields')
        .select('id,name')
        .order('name', { ascending: true })
        .returns<Field[]>();
      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * 분야 마스터에 새 분야를 추가한다(해시태그 작성 시 find-or-create 의 create 단계).
 * 같은 이름이 동시 생성/이미 존재(UNIQUE 위반 23505)하면 기존 행을 재조회해 반환한다.
 * 호출부(FieldTagInput)는 캐시된 목록에서 대소문자 무시 매칭으로 먼저 찾고, 없을 때만 호출한다.
 */
export function useCreateField() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string): Promise<Field> => {
      const trimmed = name.trim();
      const { data, error } = await supabase
        .from('fields')
        .insert({ name: trimmed })
        .select('id,name')
        .single();
      if (error) {
        if (error.code === '23505') {
          const { data: existing, error: selErr } = await supabase
            .from('fields')
            .select('id,name')
            .eq('name', trimmed)
            .single();
          if (selErr || !existing) {
            throw new Error(selErr?.message ?? '분야 조회에 실패했습니다.');
          }
          return existing as Field;
        }
        throw new Error(`분야 추가에 실패했습니다: ${error.message}`);
      }
      return data as Field;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: fieldKeys.all }),
  });
}
