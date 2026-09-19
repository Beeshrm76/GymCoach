-- ============================================================
-- GymCoach: Support Tickets + System Settings
-- Run this in your Supabase SQL Editor (Dashboard → SQL Editor → New Query)
--
-- Why this file exists: js/app.js, js/admin.js and js/superadmin.js all
-- query a `support_tickets` table and a `system_settings` table, but
-- neither was ever created by 001_relational_schema.sql. Every query
-- against them fails with "relation does not exist", which is why the
-- admin Support Tickets screen was stuck on "Loading..." forever — the
-- error was being swallowed instead of shown. This migration creates
-- both tables with the RLS the admin panels already assume.
-- ============================================================

-- 1. Support tickets
-- ============================================================

CREATE TABLE IF NOT EXISTS support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE DEFAULT auth.uid(),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN',
  response TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;

-- Optional foreign key constraint to public.profiles so PostgREST can resolve joins
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'support_tickets_profiles_fkey'
  ) THEN
    BEGIN
      ALTER TABLE support_tickets 
        ADD CONSTRAINT support_tickets_profiles_fkey 
        FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;
END $$;

DO $$ BEGIN
  -- Users see and create only their own tickets.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users manage own tickets' AND tablename = 'support_tickets') THEN
    CREATE POLICY "Users manage own tickets" ON support_tickets
      FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;

  -- Admins see and reply to tickets from users assigned to them
  -- (profiles.admin_id = the admin's auth.uid(), same relationship
  -- admin.js / superadmin.js already assume for the Users list).
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Admins view assigned users tickets' AND tablename = 'support_tickets') THEN
    CREATE POLICY "Admins view assigned users tickets" ON support_tickets
      FOR SELECT USING (
        EXISTS (
          SELECT 1 FROM profiles p
          WHERE p.id = support_tickets.user_id AND p.admin_id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Admins reply to assigned users tickets' AND tablename = 'support_tickets') THEN
    CREATE POLICY "Admins reply to assigned users tickets" ON support_tickets
      FOR UPDATE USING (
        EXISTS (
          SELECT 1 FROM profiles p
          WHERE p.id = support_tickets.user_id AND p.admin_id = auth.uid()
        )
      );
  END IF;

  -- Super admins see and reply to every ticket.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Super admins view all tickets' AND tablename = 'support_tickets') THEN
    CREATE POLICY "Super admins view all tickets" ON support_tickets
      FOR SELECT USING (
        EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'SUPER_ADMIN')
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Super admins reply to all tickets' AND tablename = 'support_tickets') THEN
    CREATE POLICY "Super admins reply to all tickets" ON support_tickets
      FOR UPDATE USING (
        EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'SUPER_ADMIN')
      );
  END IF;
END $$;

-- 2. System settings (app name, logo, default exercise library, maintenance
--    mode, workout defaults — a plain key/value table the Super Admin
--    "System Settings" and "Exercises" screens already read/write).
-- ============================================================

CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value JSONB,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  -- Anyone (including unauthenticated visitors on the login page) can read
  -- system settings (app name, logo, welcome message, maintenance banner).
  IF EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Anyone signed in can read settings' AND tablename = 'system_settings') THEN
    DROP POLICY "Anyone signed in can read settings" ON system_settings;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Anyone can read settings' AND tablename = 'system_settings') THEN
    CREATE POLICY "Anyone can read settings" ON system_settings
      FOR SELECT USING (true);
  END IF;

  -- Only admins/super admins can change settings.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Admins manage settings' AND tablename = 'system_settings') THEN
    CREATE POLICY "Admins manage settings" ON system_settings
      FOR ALL USING (
        EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('ADMIN', 'SUPER_ADMIN'))
      ) WITH CHECK (
        EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('ADMIN', 'SUPER_ADMIN'))
      );
  END IF;
END $$;
