import { STATUS_LABEL } from '../lib/status';
import type { TaskStatus } from '../lib/types';

export default function StatusBadge({ status }: { status: TaskStatus }) {
  return <span className={`badge badge-${status}`}>{STATUS_LABEL[status]}</span>;
}
