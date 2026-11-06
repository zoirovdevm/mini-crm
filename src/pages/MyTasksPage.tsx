import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { fetchTasks } from '../lib/queries';
import { errorText } from '../lib/status';
import type { Task } from '../lib/types';
import TaskTable from '../components/TaskTable';

export default function MyTasksPage() {
  const { profile } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    fetchTasks({ assigneeId: profile.id })
      .then(setTasks)
      .catch((e) => setError(errorText(e)))
      .finally(() => setLoading(false));
  }, [profile]);

  const active = tasks.filter((t) => t.status !== 'accepted');
  const done = tasks.filter((t) => t.status === 'accepted');

  return (
    <>
      <h1>Мои задачи</h1>
      {error && <div className="error">{error}</div>}
      {loading ? (
        <p className="muted">Загрузка…</p>
      ) : (
        <>
          <h2>Активные</h2>
          <TaskTable tasks={active} showObject />
          <h2>Принятые</h2>
          <TaskTable tasks={done} showObject />
        </>
      )}
    </>
  );
}
