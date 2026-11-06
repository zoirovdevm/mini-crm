import { supabase } from './supabase';
import type { Profile, Task } from './types';

// Запросы идут с JWT пользователя — база сама отфильтрует, что ему можно видеть (RLS).
export const TASK_SELECT =
  'id, title, description, object_id, assignee_id, author_id, status, created_at, updated_at,' +
  ' object:objects(id, name),' +
  ' assignee:profiles!tasks_assignee_id_fkey(full_name),' +
  ' author:profiles!tasks_author_id_fkey(full_name)';

export async function fetchTasks(filter: { objectId?: string; assigneeId?: string }): Promise<Task[]> {
  let q = supabase.from('tasks').select(TASK_SELECT).order('created_at', { ascending: false });
  if (filter.objectId) q = q.eq('object_id', filter.objectId);
  if (filter.assigneeId) q = q.eq('assignee_id', filter.assigneeId);
  const { data, error } = await q;
  if (error) throw error;
  return data as unknown as Task[];
}

export async function fetchExecutors(): Promise<Profile[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, role')
    .eq('role', 'executor')
    .order('full_name');
  if (error) throw error;
  return data as Profile[];
}
