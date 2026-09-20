-- ============================================================
-- GymCoach: Enterprise Security Hardening Migration (008)
-- Run this script in your Supabase SQL Editor (Dashboard → SQL Editor → New Query)
-- ============================================================

-- ------------------------------------------------------------
-- 1. Security Event Logging Table
-- Logs authentication, authorization, lockout, and injection events.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.security_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  event_type TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ip_hint TEXT,
  metadata JSONB DEFAULT '{}'::jsonb
);

ALTER TABLE public.security_logs ENABLE ROW LEVEL SECURITY;

-- Allow inserting security logs
DROP POLICY IF EXISTS "Allow inserting security logs" ON public.security_logs;
CREATE POLICY "Allow inserting security logs" ON public.security_logs
  FOR INSERT WITH CHECK (true);

-- Only Admins and Super Admins can inspect security audit logs
DROP POLICY IF EXISTS "Admins can view security logs" ON public.security_logs;
CREATE POLICY "Admins can view security logs" ON public.security_logs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('ADMIN', 'SUPER_ADMIN')
    )
  );


-- ------------------------------------------------------------
-- 2. Security Alerts Table
-- Triggered on critical security anomalies like 5 failed logins (lockout).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.security_alerts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  alert_type TEXT NOT NULL,
  identifier TEXT NOT NULL,
  details JSONB DEFAULT '{}'::jsonb,
  acknowledged BOOLEAN DEFAULT FALSE,
  acknowledged_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.security_alerts ENABLE ROW LEVEL SECURITY;

-- Allow inserting security alerts
DROP POLICY IF EXISTS "Allow inserting security alerts" ON public.security_alerts;
CREATE POLICY "Allow inserting security alerts" ON public.security_alerts
  FOR INSERT WITH CHECK (true);

-- Admins and Super Admins can view and acknowledge alerts
DROP POLICY IF EXISTS "Admins can view security alerts" ON public.security_alerts;
CREATE POLICY "Admins can view security alerts" ON public.security_alerts
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('ADMIN', 'SUPER_ADMIN')
    )
  );

DROP POLICY IF EXISTS "Admins can update security alerts" ON public.security_alerts;
CREATE POLICY "Admins can update security alerts" ON public.security_alerts
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('ADMIN', 'SUPER_ADMIN')
    )
  );


-- ------------------------------------------------------------
-- 3. Restrict Storage Bucket Upload Types & Sizes
-- Whitelist allowed MIME types and cap max file sizes in Supabase Storage.
-- ------------------------------------------------------------
UPDATE storage.buckets
SET 
  file_size_limit = 2097152, -- 2MB max for profile avatars
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']
WHERE id = 'avatars';

UPDATE storage.buckets
SET 
  file_size_limit = 26214400, -- 25MB max for exercise videos/images
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml', 'video/mp4', 'video/webm']
WHERE id = 'app-media';


-- ------------------------------------------------------------
-- 4. Restrict Database Permissions (Least Privilege)
-- Revoke broad public schema permissions from anon/public.
-- ------------------------------------------------------------
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM anon;
