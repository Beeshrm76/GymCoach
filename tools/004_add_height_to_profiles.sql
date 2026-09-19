-- ============================================================
-- GymCoach: Add height_cm to Profiles
-- Run this in your Supabase SQL Editor (Dashboard → SQL Editor → New Query)
-- ============================================================

DO $$ BEGIN
  -- Add height_cm to profiles table if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'profiles' AND column_name = 'height_cm'
  ) THEN
    ALTER TABLE profiles ADD COLUMN height_cm NUMERIC;
  END IF;
END $$;
