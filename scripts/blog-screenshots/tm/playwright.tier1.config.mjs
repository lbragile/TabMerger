// The Tier-1 posts' TabMerger captures (tier1Shots.spec.ts); see ../README.md.
export default {
  testDir: '.',
  testMatch: /tier1Shots\.spec\.ts/,
  workers: 1,
  retries: 0,
  reporter: 'list',
  outputDir: './results',
};
