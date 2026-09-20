-- ============================================================
-- GymCoach: Profile Sharing, Profile ID, and Weight
-- Run this in your Supabase SQL Editor (Dashboard → SQL Editor → New Query)
-- ============================================================

DO $$ 
BEGIN
  -- 1. Add profile_code to profiles if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'profiles' AND column_name = 'profile_code'
  ) THEN
    ALTER TABLE profiles ADD COLUMN profile_code TEXT UNIQUE;
  END IF;

  -- 2. Add weight_kg to profiles if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'profiles' AND column_name = 'weight_kg'
  ) THEN
    ALTER TABLE profiles ADD COLUMN weight_kg NUMERIC;
  END IF;

  -- 3. Add share_plan to profiles if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'profiles' AND column_name = 'share_plan'
  ) THEN
    ALTER TABLE profiles ADD COLUMN share_plan BOOLEAN DEFAULT FALSE;
  END IF;

  -- 4. Add share_performance to profiles if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'profiles' AND column_name = 'share_performance'
  ) THEN
    ALTER TABLE profiles ADD COLUMN share_performance BOOLEAN DEFAULT FALSE;
  END IF;

  -- 5. Add shared_project_id to profiles if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'profiles' AND column_name = 'shared_project_id'
  ) THEN
    ALTER TABLE profiles ADD COLUMN shared_project_id TEXT;
  END IF;
END $$;

-- Backfill profile_code for existing users if null
UPDATE profiles 
SET profile_code = 'GC-' || UPPER(SUBSTRING(id::text, 1, 8))
WHERE profile_code IS NULL;

-- Trigger to automatically set profile_code on profile creation
CREATE OR REPLACE FUNCTION set_default_profile_code()
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

DROP TRIGGER IF EXISTS trg_set_profile_code ON profiles;
CREATE TRIGGER trg_set_profile_code
BEFORE INSERT ON profiles
FOR EACH ROW
EXECUTE FUNCTION set_default_profile_code();

-- RLS Policies for Profiles: allow users to read profiles for search
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'Anyone can view public profiles' AND tablename = 'profiles'
  ) THEN
    CREATE POLICY "Anyone can view public profiles" ON profiles FOR SELECT USING (true);
  END IF;
END $$;

-- RLS Policies for sync_data: allow reading shared workout plans
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'Anyone can view shared workout sync data' AND tablename = 'sync_data'
  ) THEN
    CREATE POLICY "Anyone can view shared workout sync data" ON sync_data FOR SELECT 
    USING (
      auth.uid() = user_id 
      OR (
        storage_key = 'gymcoach_projects_v4' 
        AND EXISTS (SELECT 1 FROM profiles WHERE profiles.id = sync_data.user_id AND profiles.share_plan = true)
      )
    );
  END IF;
END $$;

-- RLS Policies for daily_training_scores: allow reading shared performance scores
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'Anyone can view shared daily training scores' AND tablename = 'daily_training_scores'
  ) THEN
    CREATE POLICY "Anyone can view shared daily training scores" ON daily_training_scores FOR SELECT 
    USING (
      auth.uid() = user_id 
      OR EXISTS (SELECT 1 FROM profiles WHERE profiles.id = daily_training_scores.user_id AND profiles.share_performance = true)
    );
  END IF;
END $$;
