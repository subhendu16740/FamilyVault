-- How many documents each category has, across every vault, and in how many
-- vaults. Reads only each document's category id and counts them: never a
-- name, a file or a word of text. A family's own category is counted as one
-- line, not by name (its name could say something private).
--
-- Read-only. Paste into the SQL editor of either project. Upload picks the
-- first category in the list until the person picks another, so that one
-- (Bank Statements) is overcounted.

select
  case when x.category_id is null then 'No category'
       when c.is_system then c.name
       else 'A family''s own category' end as category,
  sum(x.n)::int as documents,
  count(distinct f.id)::int as vaults
from public.families f
join pg_namespace ns on ns.nspname = f.storage_namespace
join pg_class t on t.relnamespace = ns.oid and t.relname = 'documents' and t.relkind = 'r'
cross join lateral xmltable('/table/row'
  passing query_to_xml(format(
    'select category_id, count(*) as n from %I.documents where not coalesce(is_deleted, false) group by category_id',
    f.storage_namespace), true, false, '')
  columns category_id uuid path 'category_id', n int path 'n') x
left join public.document_categories c on c.id = x.category_id
group by 1
order by 2 desc, 1;
