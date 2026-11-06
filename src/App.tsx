import { Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth';
import LoginPage from './pages/LoginPage';
import ObjectsPage from './pages/ObjectsPage';
import ObjectPage from './pages/ObjectPage';
import TaskPage from './pages/TaskPage';
import MyTasksPage from './pages/MyTasksPage';

export default function App() {
  const { session, profile, loading, signOut } = useAuth();

  if (loading) return <div className="center muted">Загрузка…</div>;
  if (!session) return <LoginPage />;
  if (!profile) return <div className="center">Профиль не найден. Обратитесь к администратору.</div>;

  const isManager = profile.role === 'manager';

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <span className="logo">Мини-CRM</span>
          <nav>
            <NavLink to="/objects">Объекты</NavLink>
            {!isManager && <NavLink to="/my">Мои задачи</NavLink>}
          </nav>
          <div className="user">
            <span>
              {profile.full_name} · <span className="muted">{isManager ? 'Постановщик' : 'Исполнитель'}</span>
            </span>
            <button className="btn btn-ghost" onClick={signOut}>
              Выйти
            </button>
          </div>
        </div>
      </header>
      <main className="container">
        <Routes>
          <Route path="/objects" element={<ObjectsPage />} />
          <Route path="/objects/:id" element={<ObjectPage />} />
          <Route path="/tasks/:id" element={<TaskPage />} />
          <Route path="/my" element={<MyTasksPage />} />
          <Route path="*" element={<Navigate to={isManager ? '/objects' : '/my'} replace />} />
        </Routes>
      </main>
    </>
  );
}
