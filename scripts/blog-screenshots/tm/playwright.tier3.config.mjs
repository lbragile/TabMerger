// The Tier-3 posts' TabMerger captures (tier3Shots.spec.ts); see ../README.md.
export default {
  testDir: '.',
  testMatch: /tier3Shots\.spec\.ts/,
  workers: 1,
  retries: 0,
  reporter: 'list',
  outputDir: './results',
};
