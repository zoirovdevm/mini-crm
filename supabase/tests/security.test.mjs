// Локальная проверка правил безопасности на настоящем Postgres (PGlite).
// Эмулирует окружение Supabase (схема auth, роли anon/authenticated, auth.uid())
// и пытается делать запрещённые вещи от имени разных пользователей.
// Запуск: npm run test:db
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const db = new PGlite();

await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  grant usage on schema public to anon, authenticated;
  -- как в Supabase: по умолчанию всем всё разрешено, миграция должна это закрыть
  alter default privileges in schema public grant all on tables to anon, authenticated;
`);

const migDir = join(here, '..', 'migrations');
for (const f of readdirSync(migDir).sort()) await db.exec(readFileSync(join(migDir, f), 'utf8'));
const U = {
  boss:  '00000000-0000-0000-0000-000000000001',
  ivan:  '00000000-0000-0000-0000-000000000002',
  petr:  '00000000-0000-0000-0000-000000000003',
};
await db.exec(`
  insert into auth.users (id, email) values
   ('${U.boss}','boss@test.ru'), ('${U.ivan}','ivan@test.ru'), ('${U.petr}','petr@test.ru');
  update public.profiles set role = 'manager' where id = '${U.boss}';
`);

let passed = 0, failed = 0;
async function as(user, sql, params = []) {
  await db.exec('begin');
  try {
    await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user ?? '']);
    await db.exec(`set local role ${user ? 'authenticated' : 'anon'}`);
    const r = await db.query(sql, params);
    await db.exec('commit');
    return r;
  } catch (e) {
    await db.exec('rollback');
    throw e;
  }
}
async function ok(name, fn) {
  try { await fn(); console.log('  ✓', name); passed++; }
  catch (e) { console.log('  ✗', name, '\n     ', e.message); failed++; }
}
async function denied(name, fn, check = () => true) {
  try {
    const r = await fn();
    if (r && r.affectedRows === 0) { console.log('  ✓', name, '(0 строк затронуто)'); passed++; return; }
    if (r && Array.isArray(r.rows) && check(r)) { console.log('  ✓', name, `(${r.rows.length} строк видно)`); passed++; return; }
    console.log('  ✗', name, '— НЕ запрещено!', JSON.stringify(r?.rows)); failed++;
  } catch (e) { console.log('  ✓', name, '→', e.message); passed++; }
}
const eq = (a, b) => { if (a !== b) throw new Error(`ожидалось ${b}, получено ${a}`); };

console.log('\nПостановщик:');
let obj1, obj2, t1, t2;
await ok('создаёт объекты', async () => {
  obj1 = (await as(U.boss, `insert into objects (name, address) values ('ЖК Север','ул. Ленина, 1') returning id`)).rows[0].id;
  obj2 = (await as(U.boss, `insert into objects (name, address) values ('Склад','пр. Мира, 5') returning id`)).rows[0].id;
});
await ok('создаёт задачи (статус всегда «Новая», автор — он сам)', async () => {
  t1 = (await as(U.boss, `insert into tasks (title, object_id, assignee_id) values ('Залить фундамент',$1,$2) returning *`, [obj1, U.ivan])).rows[0];
  t2 = (await as(U.boss, `insert into tasks (title, object_id, assignee_id) values ('Покрасить',$1,$2) returning *`, [obj2, U.petr])).rows[0];
  eq(t1.status, 'new'); eq(t1.author_id, U.boss);
});
await denied('не может задать статус при создании', () =>
  as(U.boss, `insert into tasks (title, object_id, assignee_id, status) values ('x',$1,$2,'accepted')`, [obj1, U.ivan]));
await denied('не может подделать автора', () =>
  as(U.boss, `insert into tasks (title, object_id, assignee_id, author_id) values ('x',$1,$2,$2)`, [obj1, U.ivan]));
await denied('не может назначить исполнителем постановщика', () =>
  as(U.boss, `insert into tasks (title, object_id, assignee_id) values ('x',$1,$2)`, [obj1, U.boss]));
await denied('не может сменить статус напрямую UPDATE-ом', () =>
  as(U.boss, `update tasks set status = 'accepted' where id = $1`, [t1.id]));
await denied('не может перевести «Новая» → «Принята»', () =>
  as(U.boss, `select change_task_status($1, 'accepted')`, [t1.id]));
await denied('не может взять задачу в работу за исполнителя', () =>
  as(U.boss, `select change_task_status($1, 'in_progress')`, [t1.id]));

console.log('\nИсполнитель Иван:');
await ok('видит только свою задачу и свой объект', async () => {
  eq((await as(U.ivan, `select id from tasks`)).rows.length, 1);
  const objs = (await as(U.ivan, `select id from objects`)).rows;
  eq(objs.length, 1); eq(objs[0].id, obj1);
});
await denied('не видит чужую задачу Петра', () => as(U.ivan, `select * from tasks where id = $1`, [t2.id]), r => r.rows.length === 0);
await denied('не видит историю чужой задачи', () => as(U.ivan, `select * from task_history where task_id = $1`, [t2.id]), r => r.rows.length === 0);
await denied('не может изменить чужую задачу', () => as(U.ivan, `update tasks set title = 'взлом' where id = $1`, [t2.id]));
await denied('не может сменить статус чужой задачи', () => as(U.ivan, `select change_task_status($1, 'in_progress')`, [t2.id]));
await denied('не может редактировать свою задачу', () => as(U.ivan, `update tasks set title = 'x' where id = $1`, [t1.id]));
await denied('не может создавать задачи', () =>
  as(U.ivan, `insert into tasks (title, object_id, assignee_id) values ('x',$1,$2)`, [obj1, U.ivan]));
await denied('не может создавать объекты', () => as(U.ivan, `insert into objects (name, address) values ('x','y')`));
await denied('не может удалить задачу', () => as(U.ivan, `delete from tasks where id = $1`, [t1.id]));
await denied('не может повысить себе роль', () => as(U.ivan, `update profiles set role = 'manager' where id = $1`, [U.ivan]));
await denied('не может пропустить шаг «Новая» → «На проверке»', () => as(U.ivan, `select change_task_status($1, 'review')`, [t1.id]));
await ok('берёт в работу и отправляет на проверку', async () => {
  await as(U.ivan, `select change_task_status($1, 'in_progress')`, [t1.id]);
  await as(U.ivan, `select change_task_status($1, 'review')`, [t1.id]);
});
await denied('не может сам принять свою задачу', () => as(U.ivan, `select change_task_status($1, 'accepted')`, [t1.id]));

console.log('\nИстория:');
await denied('нельзя добавить запись в историю', () =>
  as(U.ivan, `insert into task_history (task_id, changed_by, to_status) values ($1,$2,'accepted')`, [t1.id, U.ivan]));
await denied('нельзя изменить историю', () => as(U.boss, `update task_history set comment = 'подделка'`));
await denied('нельзя удалить историю', () => as(U.boss, `delete from task_history`));

console.log('\nПроверка и доработка:');
await denied('возврат на доработку без комментария запрещён', () => as(U.boss, `select change_task_status($1, 'rework', '  ')`, [t1.id]));
await ok('постановщик возвращает с комментарием', () => as(U.boss, `select change_task_status($1, 'rework', 'Нет фото')`, [t1.id]));
await ok('исполнитель снова берёт в работу → на проверку → постановщик принимает', async () => {
  await as(U.ivan, `select change_task_status($1, 'in_progress')`, [t1.id]);
  await as(U.ivan, `select change_task_status($1, 'review')`, [t1.id]);
  await as(U.boss, `select change_task_status($1, 'accepted')`, [t1.id]);
});
await denied('из «Принята» никуда нельзя', () => as(U.boss, `select change_task_status($1, 'rework', 'ещё')`, [t1.id]));
await ok('история полная и видна исполнителю', async () => {
  const h = (await as(U.ivan, `select from_status, to_status, comment, changed_by from task_history where task_id = $1 order by id`, [t1.id])).rows;
  const path = h.map(r => `${r.from_status ?? '—'}→${r.to_status}`).join(', ');
  eq(path, '—→new, new→in_progress, in_progress→review, review→rework, rework→in_progress, in_progress→review, review→accepted');
  eq(h[3].comment, 'Нет фото'); eq(h[3].changed_by, U.boss);
});

console.log('\nАнонимный пользователь (без входа):');
await denied('ничего не видит', () => as(null, `select * from tasks`));
await denied('не может вызвать смену статуса', () => as(null, `select change_task_status($1, 'in_progress')`, [t2.id]));

console.log(`\nИтого: ${passed} пройдено, ${failed} провалено\n`);
process.exit(failed ? 1 : 0);
