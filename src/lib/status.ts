import type { Profile, Task, TaskStatus } from './types';

export const STATUS_LABEL: Record<TaskStatus, string> = {
  new: 'Новая',
  in_progress: 'В работе',
  review: 'На проверке',
  accepted: 'Принята',
  rework: 'На доработке',
};

export interface StatusAction {
  to: TaskStatus;
  label: string;
  needsComment: boolean;
}

/**
 * Какие кнопки показать пользователю. Это ТОЛЬКО для удобства интерфейса —
 * те же правила продублированы и реально проверяются в базе
 * (функция public.change_task_status в миграции).
 */
export function availableActions(task: Task, me: Profile): StatusAction[] {
  const isAssignee = task.assignee_id === me.id;
  const isManager = me.role === 'manager';

  switch (task.status) {
    case 'new':
      return isAssignee ? [{ to: 'in_progress', label: 'Взять в работу', needsComment: false }] : [];
    case 'in_progress':
      return isAssignee ? [{ to: 'review', label: 'Отправить на проверку', needsComment: false }] : [];
    case 'rework':
      return isAssignee ? [{ to: 'in_progress', label: 'Взять в работу', needsComment: false }] : [];
    case 'review':
      return isManager
        ? [
            { to: 'accepted', label: 'Принять', needsComment: false },
            { to: 'rework', label: 'Вернуть на доработку', needsComment: true },
          ]
        : [];
    case 'accepted':
      return [];
  }
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
}

/** Ошибки Postgres/Supabase → понятный текст. */
export function errorText(e: unknown): string {
  const msg = (e as { message?: string })?.message ?? String(e);
  if (msg.includes('permission denied') || msg.includes('row-level security')) return 'Недостаточно прав для этого действия';
  return msg.replace(/«(new|in_progress|review|accepted|rework)»/g, (_, s: TaskStatus) => `«${STATUS_LABEL[s]}»`);
}
