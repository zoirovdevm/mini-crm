import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { errorText } from '../lib/status';
import { fetchExecutors, fetchTasks } from '../lib/queries';
import type { CrmObject, Profile, Task } from '../lib/types';
import TaskTable from '../components/TaskTable';

export default function ObjectPage() {
  const { id } = useParams<{ id: string }>();
  const { profile } = useAuth();
  const isManager = profile?.role === 'manager';
  const navigate = useNavigate();

  const [object, setObject] = useState<CrmObject | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [executors, setExecutors] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: '', address: '' });
  const [newTask, setNewTask] = useState({ title: '', description: '', assignee_id: '' });

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const { data, error } = await supabase.from('objects').select('*').eq('id', id).maybeSingle();
      if (error) throw error;
      setObject(data as CrmObject | null);
      if (data) {
        setForm({ name: data.name, address: data.address });
        // Исполнитель получит только свои задачи — это делает RLS, а не фильтр здесь.
        setTasks(await fetchTasks({ objectId: id }));
      }
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

  async function saveObject(e: FormEvent) {
    e.preventDefault();
    const { error } = await supabase.from('objects').update(form).eq('id', id!);
    if (error) return setError(errorText(error));
    setEditing(false);
    load();
  }

  async function deleteObject() {
    if (!confirm('Удалить объект вместе со всеми его задачами?')) return;
    const { error } = await supabase.from('objects').delete().eq('id', id!);
    if (error) return setError(errorText(error));
    navigate('/objects');
  }

  async function createTask(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const { error } = await supabase.from('tasks').insert({ ...newTask, object_id: id });
    if (error) return setError(errorText(error));
    setNewTask({ title: '', description: '', assignee_id: '' });
    load();
  }

  if (loading) return <p className="muted">Загрузка…</p>;
  if (!object)
    return (
      <>
        <p>Объект не найден или нет доступа.</p>
        <Link to="/objects">← К объектам</Link>
      </>
    );

  return (
    <>
      <Link to="/objects" className="back">
        ← Объекты
      </Link>
      {error && <div className="error">{error}</div>}

      {editing ? (
        <form className="card form" onSubmit={saveObject}>
          <label>
            Название
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </label>
          <label>
            Адрес
            <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} required />
          </label>
          <div className="row">
            <button className="btn btn-primary">Сохранить</button>
            <button type="button" className="btn" onClick={() => setEditing(false)}>
              Отмена
            </button>
          </div>
        </form>
      ) : (
        <div className="page-head">
          <div>
            <h1>{object.name}</h1>
            <p className="muted">{object.address}</p>
          </div>
          {isManager && (
            <div className="row">
              <button className="btn" onClick={() => setEditing(true)}>
                Редактировать
              </button>
              <button className="btn btn-danger" onClick={deleteObject}>
                Удалить
              </button>
            </div>
          )}
        </div>
      )}

      <h2>{isManager ? 'Задачи объекта' : 'Мои задачи на объекте'}</h2>
      <TaskTable tasks={tasks} />

      {isManager && (
        <form className="card form" onSubmit={createTask}>
          <h2>Новая задача</h2>
          <label>
            Название
            <input value={newTask.title} onChange={(e) => setNewTask({ ...newTask, title: e.target.value })} required />
          </label>
          <label>
            Описание
            <textarea
              value={newTask.description}
              onChange={(e) => setNewTask({ ...newTask, description: e.target.value })}
              rows={3}
            />
          </label>
          <label>
            Исполнитель
            <select
              value={newTask.assignee_id}
              onChange={(e) => setNewTask({ ...newTask, assignee_id: e.target.value })}
              required
            >
              <option value="">— выберите —</option>
              {executors.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                </option>
              ))}
            </select>
          </label>
          <button className="btn btn-primary">Создать задачу</button>
        </form>
      )}
    </>
  );
}
