import assert from 'node:assert/strict';
import test from 'node:test';
import { checkPlaywright } from './check-dependencies.mjs';

test('matching package, lockfile and installed browser image are accepted', () => {
  assert.doesNotThrow(() => checkPlaywright('1.65.1', '1.65.1', 'mcr.microsoft.com/playwright:v1.65.1-noble'));
});

test('an npm-only Playwright update fails before pulling or launching browsers', () => {
  assert.throws(() => checkPlaywright('1.65.1', '1.65.1', 'mcr.microsoft.com/playwright:v1.58.2-noble'), /browser image.*1\.65\.1/i);
});

test('a stale lockfile or unpinned Playwright declaration cannot evade the check', () => {
  assert.throws(() => checkPlaywright('1.65.1', '1.58.2', 'mcr.microsoft.com/playwright:v1.65.1-noble'), /lockfile/i);
  assert.throws(() => checkPlaywright('^1.65.1', '1.65.1', 'mcr.microsoft.com/playwright:v1.65.1-noble'), /exact version/i);
});
