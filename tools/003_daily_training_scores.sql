-- ============================================================
-- GymCoach: Daily Training Scores (DTS) Schema
-- Run this in your Supabase SQL Editor (Dashboard → SQL Editor → New Query)
--
-- Why this file exists: Supports cloud synchronization and historical tracking
-- of Daily Training Scores (DTS 0-100) computed by the mathematical scoring
-- engine (js/dts.js), along with explainable component breakdowns and
-- per-exercise progression metrics for the Statistics Dashboard.
-- ============================================================

-- 1. Daily Training Scores Table
-- ============================================================

CREATE TABLE IF NOT EXISTS daily_training_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workout_date DATE NOT NULL,
  score NUMERIC(5, 2) NOT NULL CHECK (score >= 0 AND score <= 100),
  score_band TEXT NOT NULL CHECK (score_band IN ('REST', 'LOW', 'MODERATE', 'HIGH', 'VERY_HIGH')),
  strength_component NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (strength_component >= 0 AND strength_component <= 100),
  cardio_component NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (cardio_component >= 0 AND cardio_component <= 25),
  strength_workload NUMERIC(12, 2) NOT NULL DEFAULT 0,
  cardio_workload NUMERIC(12, 2) NOT NULL DEFAULT 0,
  scoring_version TEXT NOT NULL DEFAULT 'v1',
  reference_version INT NOT NULL DEFAULT 1,
  details JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT uq_daily_training_scores_user_date UNIQUE(user_id, workout_date)
);

-- Index for fast user date-range filtering (7d, 30d, 90d, all-time queries)
CREATE INDEX IF NOT EXISTS idx_dts_user_date ON daily_training_scores(user_id, workout_date DESC);

-- Optional foreign key constraint to public.profiles so PostgREST can resolve joins
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'daily_training_scores_profiles_fkey'
  ) THEN
    BEGIN
      ALTER TABLE daily_training_scores 
        ADD CONSTRAINT daily_training_scores_profiles_fkey 
        FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;
END $$;

-- 2. Row Level Security (RLS)
-- ============================================================

ALTER TABLE daily_training_scores ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  -- Users manage (select, insert, update) their own daily scores
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users manage own daily training scores' AND tablename = 'daily_training_scores') THEN
    CREATE POLICY "Users manage own daily training scores" ON daily_training_scores
      FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;

  -- Admins view daily scores of users assigned to them
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Admins view assigned users daily scores' AND tablename = 'daily_training_scores') THEN
    CREATE POLICY "Admins view assigned users daily scores" ON daily_training_scores
      FOR SELECT USING (
        EXISTS (
          SELECT 1 FROM profiles p
          WHERE p.id = daily_training_scores.user_id AND p.admin_id = auth.uid()
        )
      );
  END IF;

  -- Super Admins view all daily scores
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Super admins view all daily scores' AND tablename = 'daily_training_scores') THEN
    CREATE POLICY "Super admins view all daily scores" ON daily_training_scores
      FOR SELECT USING (
        EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'SUPER_ADMIN')
      );
  END IF;
END $$;
