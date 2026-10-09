# Test Writer Memory Index

- [Group star sort invariant](learnings_group_star_sort.md) — useToggleGroupStar uses a stable sort within zones; test setup must place items so the toggle visibly moves them across zones
- [Supabase mock pattern](learnings_supabase_mock.md) — client/builder separation required; client must NOT be thenable or Promise.resolve unwraps it
- [Vitest hoisting](learnings_vitest_hoisting.md) — const vars in vi.mock factories cause TDZ errors; always use vi.hoisted() to declare captured mock fns
- [Extension component test patterns](learnings_component_test_patterns.md) — TooltipProvider required; useOpenWindow creates the window first, then tabs individually
- [Visual regression setup](learnings_visual_regression.md) — Playwright toHaveScreenshot, @visual tag split, video-frame/gitignore/theme-seeding gotchas, authenticated-project dashboard snapshots
- [Continue on device tests](learnings_continue_on_device_tests.md) — deviceSessions.ts + Settings/OtherDevices.tsx test layout, standalone-mountable panel, fake-timer debounce
- [Flag-off module const testing](learnings_flag_off_module_const.md) — AI_ENABLED-style flags need vi.resetModules()+dynamic import per state, not just vi.stubEnv, when consumed via a module-level const
- [Race testing technique](learnings_integration_race_testing.md) — fake Supabase gates + resetModules for second context/restart in integration tests
- [Real local Supabase suites](learnings_real_supabase_local.md) — run the real-network integration suites against the local stack; sequential files, ws transport for realtime
- [E2E Now Open live windows](learnings_e2e_now_open_live_windows.md) — e2e loads the prebuilt dev build (rebuild after edits); create real windows from the SW for Now Open specs
- [Now Open close rule tests](learnings_now_open_close_rule_tests.md) — where the "defer only the own window's active tab" rule is tested per layer; stubs need windows.getCurrent or the fallback runs
- [Saved copies and close e2e](learnings_saved_copies_and_close_e2e.md) — savedCopiesAndClose.spec.ts patterns: real windows, raw stored shape, bulk copy prepends, rebuild dev build first
