import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { errorText } from '../lib/status';
import type { CrmObject } from '../lib/types';

export default function ObjectsPage() {
  const { profile } = useAuth();
  const isManager = profile?.role === 'manager';
  const [objects, setObjects] = useState<CrmObject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');

  async function load() {
    const { data, error } = await supabase.from('objects').select('*').order('created_at');
    if (error) setError(errorText(error));
    else setObjects(data as CrmObject[]);
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const { error } = await supabase.from('objects').insert({ name, address });
    if (error) return setError(errorText(error));
    setName('');
    setAddress('');
    load();
  }

  return (
    <>
      <h1>Объекты</h1>
      {error && <div className="error">{error}</div>}
      {loading ? (
        <p className="muted">Загрузка…</p>
      ) : objects.length === 0 ? (
        <p className="muted">{isManager ? 'Объектов пока нет.' : 'У вас нет задач ни на одном объекте.'}</p>
      ) : (
        <div className="grid">
          {objects.map((o) => (
            <Link key={o.id} to={`/objects/${o.id}`} className="card card-link">
              <strong>{o.name}</strong>
              <span className="muted">{o.address}</span>
            </Link>
          ))}
        </div>
      )}

      {isManager && (
        <form className="card form" onSubmit={create}>
          <h2>Новый объект</h2>
          <label>
            Название
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label>
            Адрес
            <input value={address} onChange={(e) => setAddress(e.target.value)} required />
          </label>
          <button className="btn btn-primary">Создать объект</button>
        </form>
      )}
    </>
  );
}
