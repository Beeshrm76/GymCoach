-- ============================================================
-- GymCoach: Relational Schema + Unroll Trigger
-- Run this in your Supabase SQL Editor (Dashboard → SQL Editor → New Query)
-- ============================================================

-- 1. Base Sync Table
-- ============================================================

CREATE TABLE IF NOT EXISTS sync_data (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  storage_key TEXT NOT NULL,
  value JSONB,
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, storage_key)
);

ALTER TABLE sync_data ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users own their sync data' AND tablename = 'sync_data') THEN
    CREATE POLICY "Users own their sync data" ON sync_data FOR ALL USING (auth.uid() = user_id);
  END IF;
END $$;

-- 2. Relational tables for unrolled workout data
-- ============================================================

DROP TABLE IF EXISTS user_sets CASCADE;
DROP TABLE IF EXISTS user_exercises CASCADE;
DROP TABLE IF EXISTS user_days CASCADE;
DROP TABLE IF EXISTS user_projects CASCADE;

CREATE TABLE user_projects (
  id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT,
  goal TEXT,
  intensity_band TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, id)
);

CREATE TABLE user_days (
  id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  name TEXT,
  title TEXT,
  type TEXT DEFAULT 'workout',
  weekday INT,
  focus TEXT,
  muscles TEXT,
  number INT,
  subtitle TEXT,
  completion_pct NUMERIC,
  intensity_band TEXT,
  workout_start TEXT,
  workout_end TEXT,
  workout_duration_min NUMERIC,
  body_weight NUMERIC,
  body_waist NUMERIC,
  body_chest NUMERIC,
  body_arm NUMERIC,
  body_measured_on TEXT,
  rest_notes TEXT,
  PRIMARY KEY (user_id, project_id, id)
);

CREATE TABLE user_exercises (
  id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  day_id TEXT NOT NULL,
  name TEXT,
  weight TEXT,
  weight_unit TEXT DEFAULT 'kg',
  reps TEXT,
  sets INT,
  number INT,
  intensity_band TEXT,
  pulley_system TEXT,
  pulley_ratio NUMERIC,
  target_weight_kg NUMERIC,
  target_effective_weight_kg NUMERIC,
  target_reps_min INT,
  target_reps_max INT,
  target_rir INT,
  logged_sets INT,
  recorded_total_sec INT,
  equipment TEXT,
  tempo TEXT,
  planned_rest TEXT,
  notes TEXT,
  cues TEXT,
  PRIMARY KEY (user_id, project_id, day_id, id)
);

CREATE TABLE user_sets (
  id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  day_id TEXT NOT NULL,
  exercise_id TEXT NOT NULL,
  set_index INT,
  date TIMESTAMPTZ,
  weight TEXT,
  reps TEXT,
  time TEXT,
  rir TEXT,
  completed BOOLEAN DEFAULT false,
  number INT,
  weight_raw NUMERIC,
  weight_kg NUMERIC,
  effective_weight_kg NUMERIC,
  volume_kg NUMERIC,
  recorded_time TEXT,
  recorded_seconds INT,
  time_recorded_at TIMESTAMPTZ,
  custom_fields TEXT,
  rest_planned_sec INT,
  rest_extra_sec INT,
  rest_balance_sec INT,
  rest_default_delay_sec INT,
  rest_total_after_balancing_sec INT,
  note TEXT,
  PRIMARY KEY (user_id, project_id, day_id, exercise_id, id)
);

-- 3. Row Level Security for Relational Tables
-- ============================================================

ALTER TABLE user_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_sets ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users own their projects' AND tablename = 'user_projects') THEN
    CREATE POLICY "Users own their projects" ON user_projects FOR ALL USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users own their days' AND tablename = 'user_days') THEN
    CREATE POLICY "Users own their days" ON user_days FOR ALL USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users own their exercises' AND tablename = 'user_exercises') THEN
    CREATE POLICY "Users own their exercises" ON user_exercises FOR ALL USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users own their sets' AND tablename = 'user_sets') THEN
    CREATE POLICY "Users own their sets" ON user_sets FOR ALL USING (auth.uid() = user_id);
  END IF;
END $$;

-- 4. Trigger function: unroll gymcoach_projects_v4 JSON into relational tables
-- ============================================================

CREATE OR REPLACE FUNCTION unroll_sync_data()
RETURNS TRIGGER AS $$
DECLARE
  proj JSONB;
  d JSONB;
  ex JSONB;
  log_entry JSONB;
  set_idx INT;
BEGIN
  IF NEW.storage_key != 'gymcoach_projects_v4' THEN
    RETURN NEW;
  END IF;

  DELETE FROM user_sets WHERE user_id = NEW.user_id;
  DELETE FROM user_exercises WHERE user_id = NEW.user_id;
  DELETE FROM user_days WHERE user_id = NEW.user_id;
  DELETE FROM user_projects WHERE user_id = NEW.user_id;

  IF jsonb_typeof(NEW.value) != 'array' THEN
    RETURN NEW;
  END IF;

  FOR proj IN SELECT * FROM jsonb_array_elements(NEW.value)
  LOOP
    INSERT INTO user_projects (
      id, user_id, name, updated_at, goal, intensity_band, notes
    )
    VALUES (
      proj->>'id', NEW.user_id, proj->>'name', NEW.updated_at,
      proj->>'goal', proj->>'intensityBand', proj->>'notes'
    );

    IF proj->'days' IS NOT NULL AND jsonb_typeof(proj->'days') = 'array' THEN
      FOR d IN SELECT * FROM jsonb_array_elements(proj->'days')
      LOOP
        INSERT INTO user_days (
          id, user_id, project_id, name, title, type, weekday, focus, muscles,
          number, subtitle, completion_pct, intensity_band, workout_start, workout_end,
          workout_duration_min, body_weight, body_waist, body_chest, body_arm, body_measured_on, rest_notes
        )
        VALUES (
          d->>'id', NEW.user_id, proj->>'id', d->>'name', d->>'title',
          COALESCE(d->>'type', 'workout'), (d->>'weekday')::INT,
          d->>'focus', d->>'muscles',
          (d->>'number')::INT, d->>'subtitle', (d->>'completionPct')::NUMERIC,
          d->>'intensityBand', d->>'workoutStart', d->>'workoutEnd',
          (d->>'workoutDurationMin')::NUMERIC, (d->>'bodyWeight')::NUMERIC,
          (d->>'bodyWaist')::NUMERIC, (d->>'bodyChest')::NUMERIC,
          (d->>'bodyArm')::NUMERIC, d->>'bodyMeasuredOn', d->>'restNotes'
        );

        IF d->'exercises' IS NOT NULL AND jsonb_typeof(d->'exercises') = 'array' THEN
          FOR ex IN SELECT * FROM jsonb_array_elements(d->'exercises')
          LOOP
            INSERT INTO user_exercises (
              id, user_id, project_id, day_id, name, weight, weight_unit, reps, sets,
              number, intensity_band, pulley_system, pulley_ratio, target_weight_kg,
              target_effective_weight_kg, target_reps_min, target_reps_max, target_rir,
              logged_sets, recorded_total_sec, equipment, tempo, planned_rest, notes, cues
            )
            VALUES (
              ex->>'id', NEW.user_id, proj->>'id', d->>'id', ex->>'name',
              ex->>'weight', COALESCE(ex->>'weightUnit', 'kg'),
              ex->>'reps', (ex->>'sets')::INT,
              (ex->>'number')::INT, ex->>'intensityBand', ex->>'pulleySystem',
              (ex->>'pulleyRatio')::NUMERIC, (ex->>'targetWeightKg')::NUMERIC,
              (ex->>'targetEffectiveWeightKg')::NUMERIC, (ex->>'targetRepsMin')::INT,
              (ex->>'targetRepsMax')::INT, (ex->>'targetRir')::INT,
              (ex->>'loggedSets')::INT, (ex->>'recordedTotalSec')::INT,
              ex->>'equipment', ex->>'tempo', ex->>'plannedRest', ex->>'notes', ex->>'cues'
            );

            IF ex->'logs' IS NOT NULL AND jsonb_typeof(ex->'logs') = 'array' THEN
              set_idx := 0;
              FOR log_entry IN SELECT * FROM jsonb_array_elements(ex->'logs')
              LOOP
                INSERT INTO user_sets (
                  id, user_id, project_id, day_id, exercise_id, set_index, date, weight, reps, time, rir, completed,
                  number, weight_raw, weight_kg, effective_weight_kg, volume_kg, recorded_time, recorded_seconds,
                  time_recorded_at, custom_fields, rest_planned_sec, rest_extra_sec, rest_balance_sec, rest_default_delay_sec,
                  rest_total_after_balancing_sec, note
                )
                VALUES (
                  log_entry->>'id', NEW.user_id, proj->>'id', d->>'id', ex->>'id',
                  set_idx,
                  CASE WHEN log_entry->>'date' IS NOT NULL AND log_entry->>'date' != ''
                       THEN (log_entry->>'date')::TIMESTAMPTZ ELSE NULL END,
                  log_entry->'values'->>'weight',
                  log_entry->'values'->>'reps',
                  log_entry->'values'->>'time',
                  log_entry->>'rir',
                  COALESCE((log_entry->>'completed')::BOOLEAN, false),
                  (COALESCE(log_entry->>'number', log_entry->>'setNumber'))::INT,
                  (COALESCE(log_entry->'values'->>'weightRaw', log_entry->>'weightRaw'))::NUMERIC,
                  (COALESCE(log_entry->'values'->>'weightKg', log_entry->>'weightKg'))::NUMERIC,
                  (COALESCE(log_entry->'values'->>'effectiveWeightKg', log_entry->>'effectiveWeightKg'))::NUMERIC,
                  (COALESCE(log_entry->'values'->>'volumeKg', log_entry->>'volumeKg'))::NUMERIC,
                  COALESCE(log_entry->'values'->>'recordedTime', log_entry->>'recordedTime'),
                  (COALESCE(log_entry->'values'->>'recordedSeconds', log_entry->>'recordedSeconds'))::INT,
                  CASE WHEN COALESCE(log_entry->'values'->>'timeRecordedAt', log_entry->>'timeRecordedAt') IS NOT NULL AND COALESCE(log_entry->'values'->>'timeRecordedAt', log_entry->>'timeRecordedAt') != ''
                       THEN (COALESCE(log_entry->'values'->>'timeRecordedAt', log_entry->>'timeRecordedAt'))::TIMESTAMPTZ ELSE NULL END,
                  COALESCE(log_entry->'values'->>'customFields', log_entry->>'customFields'),
                  (COALESCE(log_entry->'values'->>'restPlannedSec', log_entry->>'restPlannedSec'))::INT,
                  (COALESCE(log_entry->'values'->>'restExtraSec', log_entry->>'restExtraSec'))::INT,
                  (COALESCE(log_entry->'values'->>'restBalanceSec', log_entry->>'restBalanceSec'))::INT,
                  (COALESCE(log_entry->'values'->>'restDefaultDelaySec', log_entry->>'restDefaultDelaySec'))::INT,
                  (COALESCE(log_entry->'values'->>'restTotalAfterBalancingSec', log_entry->>'restTotalAfterBalancingSec'))::INT,
                  COALESCE(log_entry->'values'->>'note', log_entry->>'note', log_entry->>'setNote')
                );
                set_idx := set_idx + 1;
              END LOOP;
            END IF;
          END LOOP;
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Attach trigger
-- ============================================================

DROP TRIGGER IF EXISTS trg_unroll_sync_data ON sync_data;
CREATE TRIGGER trg_unroll_sync_data
  AFTER INSERT OR UPDATE ON sync_data
  FOR EACH ROW
  EXECUTE FUNCTION unroll_sync_data();
