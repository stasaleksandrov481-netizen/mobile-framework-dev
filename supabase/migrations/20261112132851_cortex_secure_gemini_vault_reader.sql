create or replace function public.cortex_gemini_key()
returns text
language sql stable security definer
set search_path = ''
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name = 'cortex_gemini_api_key'
  order by created_at desc
  limit 1;
$$;
revoke all on function public.cortex_gemini_key() from public, anon, authenticated;
grant execute on function public.cortex_gemini_key() to service_role;
