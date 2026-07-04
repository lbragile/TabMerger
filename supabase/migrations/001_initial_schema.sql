-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Profiles table (extends auth.users)
create table if not exists public.profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  email text not null,
  stripe_customer_id text unique,
  created_at timestamptz not null default now()
);

-- Subscriptions table
create table if not exists public.subscriptions (
  id text primary key,  -- Stripe subscription ID
  user_id uuid not null references public.profiles(id) on delete cascade,
  tier text not null default 'free' check (tier in ('free', 'pro', 'pro_ai')),
  status text not null default 'active' check (status in ('active', 'canceled', 'past_due', 'trialing', 'incomplete')),
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Groups table (for cloud sync)
create table if not exists public.groups (
  id text primary key,  -- nanoid from extension
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  color text not null default 'rgba(128,128,128,1)',
  position integer not null default 0,
  windows jsonb not null default '[]'::jsonb,
  info text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- Sessions table (saved tab group snapshots)
create table if not exists public.sessions (
  id text primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  description text,
  groups jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

-- Function: auto-create profile on new user signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);

  -- Create default free subscription record
  insert into public.subscriptions (id, user_id, tier, status)
  values ('free_' || new.id, new.id, 'free', 'active');

  return new;
end;
$$;

-- Trigger: fire on new auth.users insert
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Updated_at auto-update function
create or replace function public.update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger groups_updated_at before update on public.groups
  for each row execute procedure public.update_updated_at();

create trigger subscriptions_updated_at before update on public.subscriptions
  for each row execute procedure public.update_updated_at();
