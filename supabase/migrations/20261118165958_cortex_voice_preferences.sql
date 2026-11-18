-- Historical migration already applied in production; Gemini choices follow in the next migration.
create table if not exists public.cortex_voice_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  voice_id text not null default 'pNInz6obpgDQGcFmaJgB'
    check (voice_id in ('pNInz6obpgDQGcFmaJgB', '21m00Tcm4TlvDq8ikWAM', 'EXAVITQu4vr4xnSDxMaL')),
  speed numeric(3,2) not null default 1.00 check (speed between 0.80 and 1.20),
  updated_at timestamptz not null default now()
);

alter table public.cortex_voice_preferences enable row level security;
revoke all on public.cortex_voice_preferences from anon;
grant select, insert, update on public.cortex_voice_preferences to authenticated;

create policy "Read own voice settings"
on public.cortex_voice_preferences for select to authenticated
using ((select auth.uid()) = user_id);

create policy "Insert own voice settings"
on public.cortex_voice_preferences for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "Update own voice settings"
on public.cortex_voice_preferences for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
