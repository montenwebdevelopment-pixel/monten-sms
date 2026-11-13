CREATE TABLE IF NOT EXISTS public.app_releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_name text NOT NULL,
  version_name text NOT NULL,
  version_code text NOT NULL DEFAULT '',
  package_name text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  release_notes text NOT NULL DEFAULT '',
  file_name text NOT NULL,
  file_type text NOT NULL CHECK (file_type IN ('apk', 'aab')),
  storage_path text NOT NULL UNIQUE,
  file_size bigint NOT NULL CHECK (file_size > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_app_releases_status_published
  ON public.app_releases(status, published_at DESC);

CREATE TABLE IF NOT EXISTS public.app_release_config (
  id text PRIMARY KEY CHECK (id = 'default'),
  app_name text NOT NULL DEFAULT 'MONTEN SMS',
  download_url text NOT NULL DEFAULT '',
  update_info text NOT NULL DEFAULT '',
  minimum_version text NOT NULL DEFAULT '',
  force_update boolean NOT NULL DEFAULT false,
  current_release_id uuid REFERENCES public.app_releases(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.app_release_config (id)
VALUES ('default')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.app_releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_release_config ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.app_releases FROM anon, authenticated;
REVOKE ALL ON public.app_release_config FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_releases TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.app_release_config TO service_role;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'app-release-files',
  'app-release-files',
  false,
  104857600,
  ARRAY['application/vnd.android.package-archive', 'application/octet-stream']
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE OR REPLACE FUNCTION public.publish_app_release(p_release_id uuid)
RETURNS public.app_releases
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  release_row public.app_releases;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'service role required';
  END IF;

  SELECT * INTO release_row
  FROM public.app_releases
  WHERE id = p_release_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'release not found';
  END IF;
  IF release_row.status <> 'draft' THEN
    RAISE EXCEPTION 'only draft releases can be published';
  END IF;

  UPDATE public.app_releases
  SET status = 'published', published_at = now(), updated_at = now()
  WHERE id = p_release_id
  RETURNING * INTO release_row;

  UPDATE public.app_release_config
  SET current_release_id = p_release_id, updated_at = now()
  WHERE id = 'default';

  RETURN release_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.publish_app_release(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_app_release(uuid) TO service_role;
