-- ============================================================
-- GymCoach: Super Admin Role Assignment (009)
-- Run this script in your Supabase SQL Editor (Dashboard → SQL Editor → New Query)
-- Allows Super Admins to assign and update user roles (USER, ADMIN, SUPER_ADMIN).
-- ============================================================

-- 0. Ensure updated_at column exists on profiles table (safe migration)
-- ------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'profiles' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN updated_at TIMESTAMPTZ DEFAULT now();
  END IF;
END $$;

-- 1. Ensure profiles table RLS allows Super Admins to update user roles
-- ------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE policyname = 'Super admins can update profiles' 
      AND tablename = 'profiles'
  ) THEN
    CREATE POLICY "Super admins can update profiles" ON public.profiles
      FOR UPDATE USING (
        EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.id = auth.uid()
            AND p.role = 'SUPER_ADMIN'
        )
      );
  END IF;
END $$;


-- 2. Secure RPC function to set a user's role
-- Runs with SECURITY DEFINER so that it bypasses client-side RLS limits,
-- but strictly validates that the executing caller has the SUPER_ADMIN role.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_user_role(target_user_id UUID, new_role TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_role TEXT;
  target_user_exists BOOLEAN;
BEGIN
  -- 1. Verify caller has SUPER_ADMIN role
  SELECT role INTO caller_role FROM public.profiles WHERE id = auth.uid();
  IF caller_role IS NULL OR caller_role != 'SUPER_ADMIN' THEN
    RAISE EXCEPTION 'Access Denied: Only Super Administrators can change user roles.';
  END IF;

  -- 2. Validate role argument
  new_role := UPPER(TRIM(new_role));
  IF new_role NOT IN ('USER', 'ADMIN', 'SUPER_ADMIN') THEN
    RAISE EXCEPTION 'Invalid role specified: %. Must be USER, ADMIN, or SUPER_ADMIN.', new_role;
  END IF;

  -- 3. Verify target user exists
  SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id = target_user_id) INTO target_user_exists;
  IF NOT target_user_exists THEN
    RAISE EXCEPTION 'User not found with ID %', target_user_id;
  END IF;

  -- 4. Update the role
  UPDATE public.profiles
  SET role = new_role
  WHERE id = target_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'user_id', target_user_id,
    'new_role', new_role,
    'message', 'User role updated successfully'
  );
END;
$$;

-- Grant execution to authenticated users (internal check verifies SUPER_ADMIN)
GRANT EXECUTE ON FUNCTION public.set_user_role(UUID, TEXT) TO authenticated;
