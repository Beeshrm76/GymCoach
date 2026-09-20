-- ============================================================
-- GymCoach: Supabase Security Advisor & Database Linter Fixes
-- Run this script in your Supabase SQL Editor (Dashboard → SQL Editor → New Query)
-- ============================================================

-- ------------------------------------------------------------
-- 1. Fix 'function_search_path_mutable'
-- Target: public.set_default_profile_code
-- Description: Sets search_path = '' to prevent search_path hijacking.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_default_profile_code()
RETURNS TRIGGER 
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.profile_code IS NULL THEN
    NEW.profile_code := 'GC-' || UPPER(SUBSTRING(NEW.id::text, 1, 8));
  END IF;
  RETURN NEW;
END;
$$;


-- ------------------------------------------------------------
-- 2. Fix 'public_bucket_allows_listing'
-- Targets: app-media and avatars
-- Description: Drops broad SELECT policies on storage.objects that allowed
-- clients to list all files in public buckets. Public buckets serve public URLs
-- directly without needing a SELECT policy on storage.objects.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Public media is readable by everyone" ON storage.objects;
DROP POLICY IF EXISTS "Avatar images are publicly accessible" ON storage.objects;


-- ------------------------------------------------------------
-- 3. Fix 'anon_security_definer_function_executable' & 'authenticated_security_definer_function_executable'
-- Target: public.check_username_available
-- Description: Changes from SECURITY DEFINER to SECURITY INVOKER with search_path = ''.
-- Because public profiles are readable, SECURITY DEFINER is not needed.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_username_available(p_username text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF p_username IS NULL OR TRIM(p_username) = '' THEN
    RETURN FALSE;
  END IF;

  RETURN NOT EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE LOWER(username) = LOWER(TRIM(p_username))
  );
END;
$$;

REVOKE ALL ON FUNCTION public.check_username_available(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_username_available(text) TO anon, authenticated;


-- ------------------------------------------------------------
-- 4. Fix 'anon_security_definer_function_executable'
-- Target: public.delete_own_account
-- Description: Keeps SECURITY DEFINER (required to delete from auth.users),
-- sets search_path = '', validates auth.uid(), and revokes execution from anon.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_own_account()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  
  -- Delete from auth.users; cascades to profiles & other user data
  DELETE FROM auth.users WHERE id = v_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_own_account() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_own_account() FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_own_account() TO authenticated;


-- ------------------------------------------------------------
-- 5. Harden public.resolve_username_to_email
-- Description: Sets search_path = '' and trims inputs.
-- Note: This function is required for username-based login before authentication.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_username_to_email(p_username text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_email text;
BEGIN
  IF p_username IS NULL OR TRIM(p_username) = '' THEN
    RETURN NULL;
  END IF;

  SELECT email INTO v_email
  FROM public.profiles
  WHERE LOWER(username) = LOWER(TRIM(p_username))
  LIMIT 1;

  RETURN v_email;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_username_to_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_username_to_email(text) TO anon, authenticated;
