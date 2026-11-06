import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { TASK_SELECT, fetchExecutors } from '../lib/queries';
import { STATUS_LABEL, availableActions, errorText, formatDate, type StatusAction } from '../lib/status';
import type { HistoryEntry, Profile, Task } from '../lib/types';
import StatusBadge from '../components/StatusBadge';

export default function TaskPage() {
  const { id } = useParams<{ id: string }>();
  const { profile } = useAuth();
  const isManager = profile?.role === 'manager';
  const navigate = useNavigate();

  const [task, setTask] = useState<Task | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [executors, setExecutors] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [commentFor, setCommentFor] = useState<StatusAction | null>(null);
  const [comment, setComment] = useState('');
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', assignee_id: '' });

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [t, h] = await Promise.all([
        supabase.from('tasks').select(TASK_SELECT).eq('id', id).maybeSingle(),
        supabase
          .from('task_history')
          .select('id, from_status, to_status, comment, changed_at, changer:profiles(full_name)')
          .eq('task_id', id)
          .order('changed_at', { ascending: true })
          .order('id', { ascending: true }),
      ]);
      if (t.error) throw t.error;
      if (h.error) throw h.error;
      const loaded = t.data as unknown as Task | null;
      setTask(loaded);
      setHistory(h.data as unknown as HistoryEntry[]);
      if (loaded) setForm({ title: loaded.title, description: loaded.description, assignee_id: loaded.assignee_id });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
    if (isManager) fetchExecutors().then(setExecutors).catch((e) => setError(errorText(e)));
  }, [load, isManager]);

  async function changeStatus(action: StatusAction, withComment?: string) {
    setBusy(true);
    setError(null);
    // Единственный способ сменить статус — функция в базе; она же проверит права и пишет историю.
    const { error } = await supabase.rpc('change_task_status', {
      p_task_id: id,
      p_new_status: action.to,
      p_comment: withComment ?? null,
    });
    setBusy(false);
    if (error) return setError(errorText(error));
    setCommentFor(null);
    setComment('');
    load();
  }

  function onAction(action: StatusAction) {
    if (action.needsComment) setCommentFor(action);
    else changeStatus(action);
  }

  function submitComment(e: FormEvent) {
    e.preventDefault();
    if (!comment.trim()) return setError('Комментарий обязателен');
    changeStatus(commentFor!, comment);
  }

  async function saveTask(e: FormEvent) {
    e.preventDefault();
    const { error } = await supabase.from('tasks').update(form).eq('id', id!);
    if (error) return setError(errorText(error));
    setEditing(false);
    load();
  }

  async function deleteTask() {
    if (!confirm('Удалить задачу вместе с её историей?')) return;
    const objectId = task?.object_id;
    const { error } = await supabase.from('tasks').delete().eq('id', id!);
    if (error) return setError(errorText(error));
    navigate(objectId ? `/objects/${objectId}` : '/objects');
  }

  if (loading) return <p className="muted">Загрузка…</p>;
  if (!task || !profile)
    return (
      <>
        <p>Задача не найдена или нет доступа.</p>
        <Link to="/">← Назад</Link>
      </>
    );

  const actions = availableActions(task, profile);

  return (
    <>
      <Link to={`/objects/${task.object_id}`} className="back">
        ← {task.object?.name ?? 'Объект'}
      </Link>
      {error && <div className="error">{error}</div>}

      {editing ? (
        <form className="card form" onSubmit={saveTask}>
          <label>
            Название
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
          </label>
          <label>
            Описание
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={4} />
          </label>
          <label>
            Исполнитель
            <select value={form.assignee_id} onChange={(e) => setForm({ ...form, assignee_id: e.target.value })} required>
              {executors.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                </option>
              ))}
            </select>
          </label>
          <div className="row">
            <button className="btn btn-primary">Сохранить</button>
            <button type="button" className="btn" onClick={() => setEditing(false)}>
              Отмена
            </button>
          </div>
        </form>
      ) : (
        <div className="card">
          <div className="page-head">
            <h1>{task.title}</h1>
            <StatusBadge status={task.status} />
          </div>
          {task.description && <p className="description">{task.description}</p>}
          <dl className="meta">
            <dt>Объект</dt>
            <dd>{task.object?.name}</dd>
            <dt>Исполнитель</dt>
            <dd>{task.assignee?.full_name}</dd>
            <dt>Автор</dt>
            <dd>{task.author?.full_name}</dd>
            <dt>Создана</dt>
            <dd>{formatDate(task.created_at)}</dd>
          </dl>

          {(actions.length > 0 || isManager) && (
            <div className="row actions">
              {actions.map((a) => (
                <button
                  key={a.to}
                  className={`btn ${a.to === 'rework' ? 'btn-warn' : 'btn-primary'}`}
                  disabled={busy}
                  onClick={() => onAction(a)}
                >
                  {a.label}
                </button>
              ))}
              {isManager && (
                <>
                  <span className="spacer" />
                  <button className="btn" onClick={() => setEditing(true)}>
                    Редактировать
                  </button>
                  <button className="btn btn-danger" onClick={deleteTask}>
                    Удалить
                  </button>
                </>
              )}
            </div>
          )}

          {commentFor && (
            <form className="form comment-form" onSubmit={submitComment}>
              <label>
                Что нужно доработать? (обязательно)
                <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} autoFocus />
              </label>
              <div className="row">
                <button className="btn btn-warn" disabled={busy}>
                  Вернуть на доработку
                </button>
                <button type="button" className="btn" onClick={() => setCommentFor(null)}>
                  Отмена
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      <h2>История</h2>
      <ol className="history">
        {history.map((h) => (
          <li key={h.id}>
            <div>
              <strong>{h.from_status ? `${STATUS_LABEL[h.from_status]} → ${STATUS_LABEL[h.to_status]}` : 'Задача создана'}</strong>
              <span className="muted">
                {' '}
                · {h.changer?.full_name} · {formatDate(h.changed_at)}
              </span>
            </div>
            {h.comment && <div className="history-comment">«{h.comment}»</div>}
          </li>
        ))}
      </ol>
    </>
  );
}
