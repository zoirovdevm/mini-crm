# Мини-CRM «Объекты и задачи»

Небольшая CRM для строительной компании: постановщик ставит задачи по объектам (стройкам), исполнители берут их в работу и сдают на проверку.

**Стек:** React 19 + TypeScript + Vite, Supabase (Postgres, Auth, RLS). Без UI-библиотеки, только свой CSS.

- [Объяснение для руководителя](docs/EXPLANATION.md)
- [Решения и допущения](docs/DECISIONS.md)

## Структура

```
supabase/
  migrations/20261106000001_init.sql   — таблицы, RLS, триггеры, функция смены статуса
  seed.sql                             — тестовые объекты и задачи
  tests/security.test.mjs              — автотест прав доступа (31 проверка)
src/
  lib/        — клиент Supabase, авторизация, запросы, правила кнопок
  pages/      — экраны: вход, объекты, карточка объекта, карточка задачи, «Мои задачи»
  components/ — таблица задач, бейдж статуса
```

## Как запустить

### 1. Supabase
1. Создайте проект на [supabase.com](https://supabase.com) (бесплатный тариф).
2. **Authentication → Sign In / Providers → Email**: выключите **Allow new users to sign up**.
3. **SQL Editor**: выполните целиком `supabase/migrations/20261106000001_init.sql`.
   Через Supabase CLI то же самое делает `supabase db push`.
4. **Authentication → Users → Add user → Create new user** (с галочкой *Auto Confirm User*):
   `boss@crm.test`, `ispolnitel1@crm.test`, `ispolnitel2@crm.test`.
5. **SQL Editor**: выполните `supabase/seed.sql`. Он назначит роли (boss становится постановщиком) и создаст 3 объекта и 6 задач во всех статусах.

Новые пользователи всегда создаются с ролью «Исполнитель». Чтобы сделать человека постановщиком, выполните:
```sql
update public.profiles set role = 'manager' where id = (select id from auth.users where email = '...');
```

### 2. Фронтенд
```bash
npm install
cp .env.example .env    # вписать URL проекта и anon-ключ из Project Settings → API
npm run dev             # http://localhost:5173
```

### 3. Деплой (Vercel)
Импортируйте репозиторий в Vercel и добавьте переменные окружения `VITE_SUPABASE_URL` и `VITE_SUPABASE_ANON_KEY`. `vercel.json` уже настраивает маршруты SPA.

## Проверка безопасности
```bash
npm run test:db
```
Тест поднимает настоящий Postgres в памяти (PGlite) с эмуляцией Supabase Auth, применяет миграцию и пробует запрещённые действия: читать чужие задачи, менять статус в обход правил, подделывать или удалять историю, повышать себе роль, работать без входа. Все 31 проверка должны пройти.

## Как устроена защита
| Требование | Где реализовано |
|---|---|
| Права закрыты в базе (RLS) | `enable row level security` и политики на всех 4 таблицах |
| Исполнитель не видит и не меняет чужие задачи | политика `tasks_select` (`assignee_id = auth.uid()`). Изменять задачи может только постановщик |
| Переходы статусов проверяются в базе | функция `change_task_status()`. Колонку `status` нельзя изменить напрямую: нет права UPDATE на колонку, плюс триггер-страховка |
| Историю нельзя подделать | история пишется только триггером и функцией. У клиентов есть только SELECT, прав INSERT/UPDATE/DELETE нет |
| Регистрация закрыта | выключена в настройках Auth. Новый пользователь всё равно получает только роль executor |
| Секретные ключи не во фронте | фронт использует только anon-ключ, `.env` в `.gitignore` |
