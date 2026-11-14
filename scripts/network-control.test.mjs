import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

test('origin controller tolerates a request being written and repeated browser transitions', { timeout: 10000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'shopping-network-'));
  const bin = join(dir, 'bin');
  await mkdir(bin);
  await writeFile(join(bin, 'docker'), '#!/bin/sh\ncase "$1" in\ncompose) echo test-tls ;;\nstop|start) echo "$1" >> "$CONTROL_EVENTS" ;;\nesac\n', { mode: 0o755 });
  // writeFile truncates the real request before writing its new contents.
  await writeFile(join(dir, 'request'), '');
  const controller = spawn('sh', [fileURLToPath(new URL('./network-control.sh', import.meta.url)), 'test-project', dir], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CONTROL_EVENTS: join(dir, 'events') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  controller.stderr.on('data', (chunk) => { stderr += chunk; });
  const closed = new Promise((resolve) => controller.on('close', resolve));
  const pause = () => new Promise((resolve) => setTimeout(resolve, 20));
  try {
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(controller.exitCode, null, `controller exited during a partial write: ${stderr}`);
    for (const phase of ['offline', 'online', 'offline', 'online']) {
      await writeFile(join(dir, 'request'), '');
      await new Promise((resolve) => setTimeout(resolve, 150));
      assert.equal(controller.exitCode, null, `controller exited during a partial write: ${stderr}`);
      await writeFile(join(dir, 'request'), phase);
      const deadline = Date.now() + 2000;
      while ((await readFile(join(dir, 'ack'), 'utf8').catch(() => '')).trim() !== phase) {
        assert.equal(controller.exitCode, null, stderr);
        assert.ok(Date.now() < deadline, `no acknowledgement for ${phase}: ${stderr}`);
        await pause();
      }
    }
    assert.equal(await readFile(join(dir, 'events'), 'utf8'), 'stop\nstart\nstop\nstart\n');
  } finally {
    controller.kill('SIGTERM');
    await closed;
    await rm(dir, { recursive: true, force: true });
  }
});
