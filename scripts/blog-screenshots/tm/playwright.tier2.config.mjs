// The Tier-2 posts' TabMerger captures (tier2Shots.spec.ts); see ../README.md.
export default {
  testDir: '.',
  testMatch: /tier2Shots\.spec\.ts/,
  workers: 1,
  retries: 0,
  reporter: 'list',
  outputDir: './results',
};
