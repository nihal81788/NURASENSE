-- ==============================================================================
-- NuraSense TPP — Emergency Alert System Database Schema
-- Run this script in the Supabase SQL Editor:
-- https://supabase.com/dashboard/project/rtqeevykhqomyoyxeebf/sql/new
-- ==============================================================================

-- 1. Create emergency_contacts table for family, caregivers & clinicians
create table if not exists public.emergency_contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  phone text not null,
  email text,
  relationship text default 'Family',
  is_patient boolean default false,
  created_at timestamptz default now()
);

-- Ensure is_patient column exists if table was already created earlier:
alter table public.emergency_contacts
  add column if not exists is_patient boolean default false;

-- Notify PostgREST to reload its schema cache immediately
notify pgrst, 'reload schema';

-- Index for fast user queries
create index if not exists idx_emergency_contacts_user_id on public.emergency_contacts(user_id);

-- Enable Row Level Security (RLS)
alter table public.emergency_contacts enable row level security;

-- Drop existing policies if re-running
drop policy if exists "users manage own contacts" on public.emergency_contacts;
drop policy if exists "users select own contacts" on public.emergency_contacts;
drop policy if exists "service role full access contacts" on public.emergency_contacts;

-- RLS Policy: Users can view, insert, update and delete their own emergency contacts
create policy "users manage own contacts"
  on public.emergency_contacts
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Allow service role full access (for FastAPI backend alerts dispatch)
create policy "service role full access contacts"
  on public.emergency_contacts
  for all
  to service_role
  using (true)
  with check (true);


-- 2. Create alert_logs table for audit trail & clinical history
create table if not exists public.alert_logs (
  id bigserial primary key,
  user_id uuid references auth.users(id) on delete cascade,
  potassium_level float not null,
  risk_class text default 'hypokalemia',
  location_lat float,
  location_lng float,
  sms_sent boolean default false,
  call_sent boolean default false,
  email_sent boolean default false,
  contacts_notified integer default 0,
  created_at timestamptz default now()
);

-- Index for timeline queries
create index if not exists idx_alert_logs_user_id on public.alert_logs(user_id);
create index if not exists idx_alert_logs_created_at on public.alert_logs(created_at desc);

-- Enable Row Level Security (RLS)
alter table public.alert_logs enable row level security;

-- Drop existing policies if re-running
drop policy if exists "users see own logs" on public.alert_logs;
drop policy if exists "service role full access logs" on public.alert_logs;

-- RLS Policy: Users can see their own alert history
create policy "users see own logs"
  on public.alert_logs
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Allow service role full access (for FastAPI backend to write logs)
create policy "service role full access logs"
  on public.alert_logs
  for all
  to service_role
  using (true)
  with check (true);

-- Enable Realtime publication so dashboard updates instantly when an alert is logged
alter publication supabase_realtime add table public.alert_logs;
alter publication supabase_realtime add table public.emergency_contacts;
