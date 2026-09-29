-- Seed data for local development
-- Uses placeholder UUIDs; run after `supabase start` and `supabase db reset`

-- Test user (mirrors what handle_new_user() trigger creates for a real sign-up)
-- Note: In local dev the auth.users row must exist first. When using supabase's inbucket
-- email testing, sign up via the app and these IDs will differ. These are for scripted seeding.

do $$
declare
  test_user_id uuid := '00000000-0000-0000-0000-000000000001';
  test_user2_id uuid := '00000000-0000-0000-0000-000000000002';
begin

  -- Insert test auth users (bypasses the trigger; manually replicate what the trigger does)
  insert into auth.users (id, email, created_at, updated_at, confirmation_token, email_confirmed_at, aud, role)
  values
    (test_user_id, 'dev@tabmerger.test', now(), now(), '', now(), 'authenticated', 'authenticated'),
    (test_user2_id, 'pro@tabmerger.test', now(), now(), '', now(), 'authenticated', 'authenticated')
  on conflict (id) do nothing;

  -- Profiles. The auth.users insert above fires handle_new_user(), which already created a
  -- profile (no Stripe customer) and a free subscription for each user, so these upsert over
  -- the trigger's rows instead of skipping them.
  insert into public.profiles (id, email, stripe_customer_id)
  values
    (test_user_id, 'dev@tabmerger.test', null),
    (test_user2_id, 'pro@tabmerger.test', 'cus_test_prouser_0002')
  on conflict (id) do update set stripe_customer_id = excluded.stripe_customer_id;

  -- Subscriptions: one row per user (unique user_id, migration 012), so upsert on user_id —
  -- `on conflict (id)` missed the trigger's row and failed with 23505.
  insert into public.subscriptions (id, user_id, tier, status, current_period_end)
  values
    -- Free user: seeded subscription
    ('free_' || test_user_id, test_user_id, 'free', 'active', null),
    -- Pro user: active paid subscription
    ('sub_test_pro_0002', test_user2_id, 'pro', 'active', now() + interval '30 days')
  on conflict (user_id) do update set
    id = excluded.id,
    tier = excluded.tier,
    status = excluded.status,
    current_period_end = excluded.current_period_end;

  -- Sample groups for the free dev user
  insert into public.groups (id, user_id, name, color, position, windows, info)
  values
    (
      'devgrp0001',
      test_user_id,
      'Work',
      'rgba(59, 130, 246, 1)',
      0,
      '[
        {
          "id": 1,
          "incognito": false,
          "focused": true,
          "tabs": [
            { "id": 101, "title": "GitHub", "url": "https://github.com", "favIconUrl": "https://github.com/favicon.ico", "pinned": false },
            { "id": 102, "title": "Linear", "url": "https://linear.app", "favIconUrl": "https://linear.app/favicon.ico", "pinned": false }
          ]
        }
      ]'::jsonb,
      'Daily work tabs'
    ),
    (
      'devgrp0002',
      test_user_id,
      'Research',
      'rgba(168, 85, 247, 1)',
      1,
      '[
        {
          "id": 2,
          "incognito": false,
          "focused": false,
          "tabs": [
            { "id": 201, "title": "MDN Web Docs", "url": "https://developer.mozilla.org", "favIconUrl": "https://developer.mozilla.org/favicon.ico", "pinned": false },
            { "id": 202, "title": "Can I use", "url": "https://caniuse.com", "favIconUrl": "https://caniuse.com/img/favicon-128.png", "pinned": false },
            { "id": 203, "title": "TypeScript Handbook", "url": "https://www.typescriptlang.org/docs/handbook/intro.html", "favIconUrl": "https://www.typescriptlang.org/favicon-32x32.png", "pinned": false }
          ]
        }
      ]'::jsonb,
      null
    ),
    (
      'devgrp0003',
      test_user_id,
      'Shopping',
      'rgba(34, 197, 94, 1)',
      2,
      '[
        {
          "id": 3,
          "incognito": false,
          "focused": false,
          "tabs": [
            { "id": 301, "title": "Amazon", "url": "https://www.amazon.com", "favIconUrl": "https://www.amazon.com/favicon.ico", "pinned": false }
          ]
        }
      ]'::jsonb,
      null
    )
  on conflict (id) do nothing;

  -- Sample groups for the pro user
  insert into public.groups (id, user_id, name, color, position, windows, info)
  values
    (
      'progrp0001',
      test_user2_id,
      'Design',
      'rgba(236, 72, 153, 1)',
      0,
      '[
        {
          "id": 10,
          "incognito": false,
          "focused": true,
          "tabs": [
            { "id": 1001, "title": "Figma", "url": "https://www.figma.com", "favIconUrl": "https://www.figma.com/favicon.ico", "pinned": false },
            { "id": 1002, "title": "Dribbble", "url": "https://dribbble.com", "favIconUrl": "https://dribbble.com/favicon.ico", "pinned": false }
          ]
        }
      ]'::jsonb,
      'Design resources'
    )
  on conflict (id) do nothing;

  -- Sample sessions for the pro user
  insert into public.sessions (id, user_id, name, description, groups)
  values
    (
      'sess_pro_0001',
      test_user2_id,
      'Sprint 12 Setup',
      'All tabs needed for sprint 12 work session',
      '[
        {
          "id": "snapgrp01",
          "name": "Planning",
          "color": "rgba(59, 130, 246, 1)",
          "updatedAt": 1720000000000,
          "windows": [
            {
              "id": 1,
              "incognito": false,
              "focused": true,
              "tabs": [
                { "id": 1, "title": "Linear Sprint 12", "url": "https://linear.app/team/sprint-12", "pinned": false }
              ]
            }
          ]
        }
      ]'::jsonb
    )
  on conflict (id) do nothing;

end $$;
