-- Every change stamps its own time.
--
-- The library computer asks "what changed since I last synced?" and the answer
-- is whatever has a newer `updated_at`. If a row could be edited without that
-- column moving, the change would never reach the library — the book would be
-- renamed in the office and stay wrong on the shelf forever.
--
-- So the database stamps it, not the application. An edit made from the
-- browser, from the desktop, or by hand in the Supabase table editor all
-- count the same.

create function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'app_settings', 'staff_users', 'classes', 'students', 'categories',
    'shelf_locations', 'books', 'book_copies', 'loans'
  ]
  loop
    execute format(
      'create trigger touch_updated_at
         before update on public.%I
         for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;
