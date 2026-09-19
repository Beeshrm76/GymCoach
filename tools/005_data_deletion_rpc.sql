-- GymCoach: Data Deletion & Email Preferences

-- 1. Add unsubscribed boolean to profiles
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'profiles' AND column_name = 'unsubscribed'
  ) THEN
    ALTER TABLE profiles ADD COLUMN unsubscribed BOOLEAN DEFAULT FALSE;
  END IF;
END $$;

-- 2. RPC to delete own account (Requires SECURITY DEFINER)
-- Note: Must be executed by a superuser (e.g., supabase_admin) to have access to auth.users.
CREATE OR REPLACE FUNCTION delete_own_account()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  -- Delete the authenticated user from auth.users. 
  -- Supabase's ON DELETE CASCADE will handle the profiles and other linked data.
  DELETE FROM auth.users WHERE id = auth.uid();
END;
$$;
