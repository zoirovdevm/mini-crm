export type Role = 'manager' | 'executor';
export type TaskStatus = 'new' | 'in_progress' | 'review' | 'accepted' | 'rework';

export interface Profile {
  id: string;
  full_name: string;
  role: Role;
}

export interface CrmObject {
  id: string;
  name: string;
  address: string;
  created_at: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  object_id: string;
  assignee_id: string;
  author_id: string;
  status: TaskStatus;
  created_at: string;
  updated_at: string;
  object?: { id: string; name: string } | null;
  assignee?: { full_name: string } | null;
  author?: { full_name: string } | null;
}

export interface HistoryEntry {
  id: number;
  from_status: TaskStatus | null;
  to_status: TaskStatus;
  comment: string | null;
  changed_at: string;
  changer?: { full_name: string } | null;
}
