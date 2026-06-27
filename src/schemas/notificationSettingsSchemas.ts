import { z } from 'zod';

export const globalNotificationSettingsSchema = z.object({
  provider: z.enum(['MOCK', 'SOLAPI']),
  dispatch_enabled: z.boolean(),
  sender_phone: z.string().trim().nullable().optional(),
});

export type GlobalNotificationSettingsInput = z.infer<typeof globalNotificationSettingsSchema>;

export const eventNotificationSettingsSchema = z.object({
  notification_policy: z.enum(['NONE', 'ALIMTALK', 'SMS', 'ALIMTALK_SMS']),
  send_booking_open: z.boolean(),
  send_booking_created: z.boolean(),
  send_booking_changed: z.boolean(),
  send_booking_cancelled: z.boolean(),
  send_unbooked_reminder: z.boolean(),
  send_event_reminder: z.boolean(),
});

export type EventNotificationSettingsInput = z.infer<typeof eventNotificationSettingsSchema>;
