import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { useAuthStore } from '@/stores/authStore';
import type { NotificationSettings, EventNotificationSettings } from '@/types/notificationSettings';
import type {
  GlobalNotificationSettingsInput,
  EventNotificationSettingsInput,
} from '@/schemas/notificationSettingsSchemas';

// ─── 전역 알림 설정 ─────────────────────────────────────────────────────────

export function useGlobalNotificationSettings() {
  const status = useAuthStore((s) => s.status);
  return useQuery<NotificationSettings | null>({
    queryKey: ['notification-settings'],
    enabled: status === 'authenticated',
    queryFn: async () => {
      const { data, error } = await supabase
        .from('notification_settings')
        .select('*')
        .eq('id', 1)
        .single();
      if (error) throw new Error(error.message);
      return data as NotificationSettings;
    },
  });
}

export function useUpdateGlobalNotificationSettings() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  return useMutation({
    mutationFn: async (values: GlobalNotificationSettingsInput) => {
      const { error } = await supabase
        .from('notification_settings')
        .update({
          ...values,
          updated_by: user?.id ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', 1);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['notification-settings'] });
    },
  });
}

// ─── 행사별 알림 설정 ────────────────────────────────────────────────────────

export function useEventNotificationSettings(eventId: string) {
  const status = useAuthStore((s) => s.status);
  return useQuery<EventNotificationSettings | null>({
    queryKey: ['event-notification-settings', eventId],
    enabled: status === 'authenticated' && Boolean(eventId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('event_notification_settings')
        .select('*')
        .eq('event_id', eventId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data as EventNotificationSettings | null;
    },
  });
}

// ─── 테스트 발송 ─────────────────────────────────────────────────────────────

export interface TestSendResult {
  ok: boolean;
  reason?: string;
  provider?: string;
}

export function useTestNotification() {
  const qc = useQueryClient();
  return useMutation<TestSendResult, Error, string>({
    mutationFn: async (destination: string) => {
      const { data, error } = await supabase.functions.invoke<TestSendResult>(
        'notification-test',
        { body: { destination: destination.trim() } },
      );
      if (error) throw new Error(error.message);
      if (!data) throw new Error('테스트 발송 응답이 없습니다.');
      return data;
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['notification-settings'] });
    },
  });
}

export function useUpsertEventNotificationSettings(eventId: string) {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  return useMutation({
    mutationFn: async (values: EventNotificationSettingsInput) => {
      const { error } = await supabase
        .from('event_notification_settings')
        .upsert({
          event_id: eventId,
          ...values,
          updated_by: user?.id ?? null,
          updated_at: new Date().toISOString(),
        });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['event-notification-settings', eventId] });
    },
  });
}
