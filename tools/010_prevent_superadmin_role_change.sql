-- ============================================================
-- GymCoach - Migration 010: Prevent Super Admin Role Changes by Other Super Admins
-- ============================================================
-- Ensures one Super Administrator cannot demote or alter another
-- Super Administrator's role, preserving root administrative integrity.
-- ============================================================

CREATE OR REPLACE FUNCTION public.set_user_role(target_user_id UUID, new_role TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_role TEXT;
  target_user_exists BOOLEAN;
  target_current_role TEXT;
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

  -- 3. Verify target user exists and fetch current role
  SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id = target_user_id) INTO target_user_exists;
  IF NOT target_user_exists THEN
    RAISE EXCEPTION 'User not found with ID %', target_user_id;
  END IF;

  SELECT role INTO target_current_role FROM public.profiles WHERE id = target_user_id;

  -- 4. Guard: One Super Admin cannot change another Super Admin's role
  IF target_current_role = 'SUPER_ADMIN' AND target_user_id != auth.uid() THEN
    RAISE EXCEPTION 'Access Denied: A Super Administrator cannot modify another Super Administrator''s role.';
  END IF;

  -- 5. Update the role
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

GRANT EXECUTE ON FUNCTION public.set_user_role(UUID, TEXT) TO authenticated;
