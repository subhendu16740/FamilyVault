-- Owner-rights functions a client role can call that never ask who is
-- calling. Must return ZERO rows on both projects (migration 023; CLAUDE.md
-- "Read this first", point 2). Any row is a function that trusts a caller-
-- supplied id or checks nothing, and runs with the owner's rights.
SELECT p.proname
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prosecdef
  AND pg_get_function_result(p.oid) NOT IN ('trigger', 'event_trigger')
  AND (p.proacl IS NULL OR array_to_string(p.proacl, ' ') ~ '(^|[ =])(anon|authenticated)=')
  AND p.prosrc !~ 'auth\.uid\(\)|assert_caller_'
  AND NOT EXISTS (SELECT 1 FROM pg_depend d JOIN pg_extension e ON e.oid = d.refobjid
                  WHERE d.objid = p.oid AND d.deptype = 'e')
ORDER BY 1
