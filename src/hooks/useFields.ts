import { useQuery } from '@tanstack/react-query';
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
