DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'purchased_numbers'
  ) THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication
      WHERE pubname = 'supabase_realtime'
    ) THEN
      RAISE EXCEPTION 'Supabase Realtime publication does not exist';
    END IF;

    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.purchased_numbers';
  END IF;
END
$$;
