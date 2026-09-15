-- A category may lend for its own period. Null keeps the library's default.
--
-- Textbooks are the reason: they are lent for the school year, not a fortnight.
-- Setting it on the category rather than per loan means a librarian at the desk
-- cannot forget, and a child's textbook does not turn red in the overdue report
-- in October. Capped, because a typo of 3650 would put a book beyond every
-- report for a decade and nobody would notice until the shelf was empty.
alter table public.categories
  add column loan_days integer null
  check (loan_days is null or (loan_days > 0 and loan_days <= 400));

comment on column public.categories.loan_days is
  'How long books in this category go out for. Null uses the library-wide default.';

-- A librarian may catalogue a book.
--
-- The library asked for this after seeing the first sync: books arrive at the
-- library, in a box, with the scanner on the desk. Insisting they be entered
-- from the office was a rule nobody would have kept.
--
-- What stays the office's: the pupils, the classes, the accounts and the
-- settings. A librarian's screen does not decide who the children are.
do $$
declare
  t text;
  catalogue constant text[] := array['categories', 'shelf_locations', 'books', 'book_copies'];
begin
  foreach t in array catalogue
  loop
    execute format('drop policy if exists office_write on public.%I', t);
    execute format(
      'create policy catalogue_write on public.%I for all
         to authenticated
         using (private.staff_role() in (''admin'', ''librarian''))
         with check (private.staff_role() in (''admin'', ''librarian''))', t);
  end loop;
end $$;
