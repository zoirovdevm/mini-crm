-- =====================================================================
-- Mini-CRM «Объекты и задачи» — схема, права доступа (RLS) и бизнес-правила
-- Все правила проверяются в базе, поэтому работают даже при запросах
-- к Supabase напрямую, в обход интерфейса.
-- =====================================================================

-- ---------- Типы ----------
create type public.user_role as enum ('manager', 'executor');           -- постановщик / исполнитель
create type public.task_status as enum (
  'new',          -- Новая
  'in_progress',  -- В работе
  'review',       -- На проверке
  'accepted',     -- Принята
  'rework'        -- На доработке
);

-- ---------- Таблицы ----------
create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  full_name  text not null default '',
  role       public.user_role not null default 'executor',
  created_at timestamptz not null default now()
);

create table public.objects (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(trim(name)) > 0),
  address    text not null check (length(trim(address)) > 0),
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.tasks (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (length(trim(title)) > 0),
  description text not null default '',
  object_id   uuid not null references public.objects (id) on delete cascade,
  assignee_id uuid not null references public.profiles (id) on delete restrict,
  status      public.task_status not null default 'new',
  author_id   uuid not null references public.profiles (id) on delete restrict,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index tasks_object_id_idx   on public.tasks (object_id);
create index tasks_assignee_id_idx on public.tasks (assignee_id);

create table public.task_history (
  id          bigint generated always as identity primary key,
  task_id     uuid not null references public.tasks (id) on delete cascade,
  changed_by  uuid not null references public.profiles (id) on delete restrict,
  from_status public.task_status,            -- null = задача создана
  to_status   public.task_status not null,
  comment     text,
  changed_at  timestamptz not null default now()
);
create index task_history_task_id_idx on public.task_history (task_id, changed_at);

-- ---------- Вспомогательные функции ----------
-- security definer: читает profiles в обход RLS, чтобы политики не зацикливались.
create or replace function public.is_manager()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'manager');
$$;

-- Профиль создаётся автоматически при создании пользователя в Supabase.
-- Роль ВСЕГДА 'executor': назначить постановщика можно только вручную (SQL / Dashboard),
-- поэтому никто не может «выдать» себе права через метаданные регистрации.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)), 'executor');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Триггеры задач ----------
-- Перед вставкой: статус всегда «Новая», автор — текущий пользователь, исполнитель — с ролью executor.
create or replace function public.tasks_before_insert()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  new.status     := 'new';
  new.author_id  := auth.uid();
  new.created_at := now();
  new.updated_at := now();
  if not exists (select 1 from public.profiles where id = new.assignee_id and role = 'executor') then
    raise exception 'Исполнителем можно назначить только пользователя с ролью «Исполнитель»';
  end if;
  return new;
end;
$$;

create trigger tasks_before_insert
  before insert on public.tasks
  for each row execute function public.tasks_before_insert();

-- Перед обновлением: автора и дату создания менять нельзя; статус — только через change_task_status().
create or replace function public.tasks_before_update()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.status is distinct from old.status
     and coalesce(current_setting('app.status_change_allowed', true), '') <> 'on' then
    raise exception 'Статус меняется только через change_task_status()';
  end if;
  new.author_id  := old.author_id;
  new.created_at := old.created_at;
  new.updated_at := now();
  if new.assignee_id is distinct from old.assignee_id
     and not exists (select 1 from public.profiles where id = new.assignee_id and role = 'executor') then
    raise exception 'Исполнителем можно назначить только пользователя с ролью «Исполнитель»';
  end if;
  return new;
end;
$$;

create trigger tasks_before_update
  before update on public.tasks
  for each row execute function public.tasks_before_update();

-- После создания задачи — первая запись истории: «— → Новая».
create or replace function public.tasks_after_insert()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.task_history (task_id, changed_by, from_status, to_status)
  values (new.id, new.author_id, null, 'new');
  return new;
end;
$$;

create trigger tasks_after_insert
  after insert on public.tasks
  for each row execute function public.tasks_after_insert();

-- ---------- Смена статуса: единственный путь ----------
-- Проверяет, кто меняет и допустим ли переход (таблица из ТЗ), и пишет историю.
create or replace function public.change_task_status(
  p_task_id    uuid,
  p_new_status public.task_status,
  p_comment    text default null
)
returns public.tasks
language plpgsql security definer set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_task    public.tasks;
  v_manager boolean := public.is_manager();
  v_comment text := nullif(trim(coalesce(p_comment, '')), '');
  v_old     public.task_status;
begin
  if v_uid is null then
    raise exception 'Требуется вход в систему';
  end if;

  select * into v_task from public.tasks where id = p_task_id for update;

  -- Чужую задачу исполнитель «не видит» — отвечаем так же, как если бы её не было.
  if not found or (not v_manager and v_task.assignee_id <> v_uid) then
    raise exception 'Задача не найдена';
  end if;
  v_old := v_task.status;

  if (v_task.status = 'new'         and p_new_status = 'in_progress')
  or (v_task.status = 'in_progress' and p_new_status = 'review')
  or (v_task.status = 'rework'      and p_new_status = 'in_progress') then
    if v_task.assignee_id <> v_uid then
      raise exception 'Этот переход может выполнить только назначенный исполнитель';
    end if;

  elsif v_task.status = 'review' and p_new_status in ('accepted', 'rework') then
    if not v_manager then
      raise exception 'Этот переход может выполнить только постановщик';
    end if;
    if p_new_status = 'rework' and v_comment is null then
      raise exception 'При возврате на доработку комментарий обязателен';
    end if;

  else
    raise exception 'Переход «%» → «%» запрещён', v_task.status, p_new_status;
  end if;

  perform set_config('app.status_change_allowed', 'on', true);   -- только внутри этой транзакции
  update public.tasks set status = p_new_status where id = p_task_id returning * into v_task;
  perform set_config('app.status_change_allowed', '', true);

  insert into public.task_history (task_id, changed_by, from_status, to_status, comment)
  values (p_task_id, v_uid, v_old, p_new_status, v_comment);

  return v_task;
end;
$$;

-- ---------- RLS ----------
alter table public.profiles     enable row level security;
alter table public.objects      enable row level security;
alter table public.tasks        enable row level security;
alter table public.task_history enable row level security;

-- Профили: имена и роли видят все вошедшие (нужно для выбора исполнителя и истории).
-- Изменять профили через API нельзя никому (в т.ч. повышать себе роль).
create policy profiles_select on public.profiles
  for select to authenticated using (true);

-- Объекты: постановщик видит всё; исполнитель — только объекты, где у него есть задачи.
create policy objects_select on public.objects
  for select to authenticated
  using (
    public.is_manager()
    or exists (select 1 from public.tasks t where t.object_id = objects.id and t.assignee_id = auth.uid())
  );
create policy objects_insert on public.objects
  for insert to authenticated with check (public.is_manager());
create policy objects_update on public.objects
  for update to authenticated using (public.is_manager()) with check (public.is_manager());
create policy objects_delete on public.objects
  for delete to authenticated using (public.is_manager());

-- Задачи: постановщик видит всё; исполнитель — только свои. Создаёт/правит/удаляет только постановщик.
create policy tasks_select on public.tasks
  for select to authenticated
  using (public.is_manager() or assignee_id = auth.uid());
create policy tasks_insert on public.tasks
  for insert to authenticated with check (public.is_manager());
create policy tasks_update on public.tasks
  for update to authenticated using (public.is_manager()) with check (public.is_manager());
create policy tasks_delete on public.tasks
  for delete to authenticated using (public.is_manager());

-- История: только чтение, и только по задачам, которые пользователь видит.
-- Политик на insert/update/delete нет → через API историю не подделать и не удалить.
create policy task_history_select on public.task_history
  for select to authenticated
  using (
    exists (
      select 1 from public.tasks t
      where t.id = task_history.task_id
        and (public.is_manager() or t.assignee_id = auth.uid())
    )
  );

-- ---------- Привилегии (второй уровень защиты поверх RLS) ----------
-- Supabase по умолчанию выдаёт anon/authenticated все права — забираем и выдаём точечно.
revoke all on public.profiles, public.objects, public.tasks, public.task_history from anon, authenticated;

grant select on public.profiles, public.task_history to authenticated;
grant select, insert, update, delete on public.objects to authenticated;
grant select, delete on public.tasks to authenticated;
-- Колонки status, author_id, created_at клиент не может ни задать, ни изменить напрямую.
grant insert (title, description, object_id, assignee_id) on public.tasks to authenticated;
grant update (title, description, object_id, assignee_id) on public.tasks to authenticated;

revoke execute on function public.change_task_status(uuid, public.task_status, text) from public, anon;
grant  execute on function public.change_task_status(uuid, public.task_status, text) to authenticated;
revoke execute on function public.is_manager() from public, anon;
grant  execute on function public.is_manager() to authenticated;
revoke execute on function public.handle_new_user()     from public, anon, authenticated;
revoke execute on function public.tasks_before_insert() from public, anon, authenticated;
revoke execute on function public.tasks_before_update() from public, anon, authenticated;
revoke execute on function public.tasks_after_insert()  from public, anon, authenticated;
