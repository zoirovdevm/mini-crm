-- Тестовые данные. Выполнить в Supabase → SQL Editor ПОСЛЕ того, как созданы 3 пользователя
-- (Authentication → Users → Add user → Create new user, галочка «Auto Confirm User»):
--   boss@crm.test        — постановщик (Сергей Начальников)
--   ispolnitel1@crm.test — исполнитель (Иван Петров)
--   ispolnitel2@crm.test — исполнитель (Пётр Сидоров)
-- SQL Editor работает от роли postgres, поэтому auth.uid() здесь пустой —
-- подставляем пользователей явно через request.jwt.claim.sub.

do $$
declare
  v_boss uuid := (select id from auth.users where email = 'boss@crm.test');
  v_ivan uuid := (select id from auth.users where email = 'ispolnitel1@crm.test');
  v_petr uuid := (select id from auth.users where email = 'ispolnitel2@crm.test');
  o1 uuid; o2 uuid; o3 uuid;
  t uuid;

begin
  if v_boss is null or v_ivan is null or v_petr is null then
    raise exception 'Сначала создайте пользователей boss@crm.test, ispolnitel1@crm.test, ispolnitel2@crm.test';
  end if;

  update public.profiles set role = 'manager',  full_name = 'Сергей Начальников' where id = v_boss;
  update public.profiles set role = 'executor', full_name = 'Иван Петров'        where id = v_ivan;
  update public.profiles set role = 'executor', full_name = 'Пётр Сидоров'       where id = v_petr;

  perform set_config('request.jwt.claim.sub', v_boss::text, true);

  insert into public.objects (name, address) values ('ЖК «Северный»', 'г. Москва, ул. Ленина, 12') returning id into o1;
  insert into public.objects (name, address) values ('Складской комплекс', 'Московская обл., Химки, пр. Мира, 5') returning id into o2;
  insert into public.objects (name, address) values ('Школа №7, ремонт', 'г. Москва, ул. Садовая, 3') returning id into o3;

  -- 1. Новая
  insert into public.tasks (title, description, object_id, assignee_id)
  values ('Разметка участка', 'Вынести оси здания по проекту', o1, v_ivan);

  -- 2. В работе
  insert into public.tasks (title, description, object_id, assignee_id)
  values ('Залить фундамент', 'Бетон М300, секция А', o1, v_ivan) returning id into t;
  perform set_config('request.jwt.claim.sub', v_ivan::text, true);
  perform public.change_task_status(t, 'in_progress');

  -- 3. На проверке
  perform set_config('request.jwt.claim.sub', v_boss::text, true);
  insert into public.tasks (title, description, object_id, assignee_id)
  values ('Монтаж ворот', 'Секционные ворота, 2 шт.', o2, v_petr) returning id into t;
  perform set_config('request.jwt.claim.sub', v_petr::text, true);
  perform public.change_task_status(t, 'in_progress');
  perform public.change_task_status(t, 'review');

  -- 4. На доработке
  perform set_config('request.jwt.claim.sub', v_boss::text, true);
  insert into public.tasks (title, description, object_id, assignee_id)
  values ('Покраска стен в классах', 'Цвет по согласованию с заказчиком', o3, v_ivan) returning id into t;
  perform set_config('request.jwt.claim.sub', v_ivan::text, true);
  perform public.change_task_status(t, 'in_progress');
  perform public.change_task_status(t, 'review');
  perform set_config('request.jwt.claim.sub', v_boss::text, true);
  perform public.change_task_status(t, 'rework', 'Остались подтёки у окон, нужно перекрасить');

  -- 5. Принята
  insert into public.tasks (title, description, object_id, assignee_id)
  values ('Установка освещения', 'Светильники LED на складе', o2, v_petr) returning id into t;
  perform set_config('request.jwt.claim.sub', v_petr::text, true);
  perform public.change_task_status(t, 'in_progress');
  perform public.change_task_status(t, 'review');
  perform set_config('request.jwt.claim.sub', v_boss::text, true);
  perform public.change_task_status(t, 'accepted');

  -- 6. Новая, у Петра
  insert into public.tasks (title, description, object_id, assignee_id)
  values ('Вывоз мусора', 'Заказать контейнер 20 м³', o3, v_petr);
end $$;