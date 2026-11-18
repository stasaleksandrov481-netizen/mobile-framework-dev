-- Already applied in Supabase production on 2026-11-18. Retained here for reproducible migration history.
alter table public.cortex_voice_preferences
  alter column voice_id set default 'Kore';

alter table public.cortex_voice_preferences
  drop constraint if exists cortex_voice_preferences_voice_id_check;

update public.cortex_voice_preferences
set voice_id = case voice_id
  when '21m00Tcm4TlvDq8ikWAM' then 'Puck'
  when 'EXAVITQu4vr4xnSDxMaL' then 'Charon'
  else 'Kore'
end,
updated_at = now()
where voice_id not in ('Kore', 'Puck', 'Charon');

alter table public.cortex_voice_preferences
  add constraint cortex_voice_preferences_voice_id_check
  check (voice_id in ('Kore', 'Puck', 'Charon'));
