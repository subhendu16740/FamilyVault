-- One row per object type: how many, and a hash of their definitions.
-- DEV and PROD must return identical rows (migration 024; CLAUDE.md "The
-- migration gap"). Changing a database by hand without a migration is what
-- made them differ before — PROD could not create a vault because of it.
with objs as (
  select 'function' k, p.oid::regprocedure::text||' '||md5(regexp_replace(pg_get_functiondef(p.oid), '\s+', ' ', 'g'))||' '||coalesce(array_to_string(p.proacl,' '),'NULL') v
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and not exists (select 1 from pg_depend d join pg_extension e on e.oid=d.refobjid where d.objid=p.oid and d.deptype='e')
  union all select 'column', table_name||'.'||column_name||' '||data_type||' null='||is_nullable||' def='||coalesce(column_default,'') from information_schema.columns where table_schema='public'
  union all select 'policy', schemaname||'.'||tablename||'.'||policyname||' '||cmd||' '||array_to_string(roles,',')||' USING '||coalesce(qual,'')||' CHECK '||coalesce(with_check,'') from pg_policies where schemaname in ('public','storage')
  union all select 'rls', c.relname||' '||c.relrowsecurity from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r'
  union all select 'trigger(app)', event_object_schema||'.'||event_object_table||'.'||trigger_name||' '||action_timing||' '||event_manipulation||' '||action_statement from information_schema.triggers where event_object_schema in ('public','auth')
  union all select 'index', indexname||' '||indexdef from pg_indexes where schemaname='public'
  union all select 'constraint', conrelid::regclass::text||'.'||conname||' '||pg_get_constraintdef(oid) from pg_constraint where connamespace='public'::regnamespace
  union all select 'tablegrant', table_name||' '||grantee||' '||privilege_type from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated','service_role')
  -- Migration 025's protection lives in COLUMN grants (which columns a client
  -- may write), and table grants cannot see them: `GRANT UPDATE (is_superuser)
  -- ON users TO authenticated` on one project would leave every row above
  -- unchanged.
  union all select 'columngrant', table_name||'.'||column_name||' '||grantee||' '||privilege_type from information_schema.column_privileges where table_schema='public' and grantee in ('anon','authenticated') and privilege_type in ('INSERT','UPDATE')
  union all select 'bucket', id||' public='||public from storage.buckets
  union all select 'category', name from public.document_categories
)
select k, count(*) n, md5(string_agg(v, E'\n' order by v)) h from objs group by k order by k
