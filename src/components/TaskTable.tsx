import { Link } from 'react-router-dom';
import type { Task } from '../lib/types';
import { formatDate } from '../lib/status';
import StatusBadge from './StatusBadge';

export default function TaskTable({ tasks, showObject = false }: { tasks: Task[]; showObject?: boolean }) {
  if (tasks.length === 0) return <p className="muted">Задач нет.</p>;
  return (
    <table className="table">
      <thead>
        <tr>
          <th>Задача</th>
          {showObject && <th>Объект</th>}
          <th>Исполнитель</th>
          <th>Статус</th>
          <th>Создана</th>
        </tr>
      </thead>
      <tbody>
        {tasks.map((t) => (
          <tr key={t.id}>
            <td>
              <Link to={`/tasks/${t.id}`}>{t.title}</Link>
            </td>
            {showObject && <td>{t.object?.name}</td>}
            <td>{t.assignee?.full_name}</td>
            <td>
              <StatusBadge status={t.status} />
            </td>
            <td className="muted">{formatDate(t.created_at)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
