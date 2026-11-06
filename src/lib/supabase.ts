import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
// Только публичный anon-ключ. service_role во фронтенде не используется никогда:
// все права проверяются в базе (RLS + функции), а не здесь.
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!url || !anonKey) {
  throw new Error('Заполните VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY в файле .env (см. .env.example)');
}

export const supabase = createClient(url, anonKey);
