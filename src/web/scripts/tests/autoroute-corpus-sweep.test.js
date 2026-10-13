/*
 * Copyright 2026 Jason Figge
 *
 * This file is part of Chip Hippo.
 *
 * Chip Hippo is free software: you can redistribute it and/or modify it under
 * the terms of the GNU General Public License as published by the Free
 * Software Foundation, either version 3 of the License, or (at your option)
 * any later version.
 *
 * Chip Hippo is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
 * FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for
 * more details.
 *
 * You should have received a copy of the GNU General Public License along
 * with Chip Hippo. If not, see <https://www.gnu.org/licenses/>.
 */

// autoroute-corpus-sweep.test.js — the auto-route corpus's other half: that
// it is there at all, every board in exactly one routing shard, and the sweep
// for determinism and quality (autoroute-corpus.js).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { FILES, SHARDS, shardFiles, sweep } from "./autoroute-corpus.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));

test("the corpus is actually there", () => {
  assert.ok(FILES.length > 40, `${FILES.length} shipped examples`);
});

test("every shipped example is routed by exactly one shard", () => {
  // The deal covers every example once…
  const dealt = [];
  for (let k = 1; k <= SHARDS; k += 1) dealt.push(...shardFiles(k));
  assert.deepEqual([...dealt].sort(), [...FILES].sort());
  // …and every share of it has a test file that routes it, and only it: a
  // shard file missing (or SHARDS raised without one) would drop a share of
  // the corpus with nothing failing.
  const shards = readdirSync(HERE)
    .map((f) => /^autoroute-corpus-(\d+)\.test\.js$/.exec(f)?.[1])
    .filter(Boolean)
    .map(Number)
    .sort((a, b) => a - b);
  assert.deepEqual(
    shards,
    Array.from({ length: SHARDS }, (_, i) => i + 1),
  );
  for (const k of shards) {
    const text = readFileSync(`${HERE}autoroute-corpus-${k}.test.js`, "utf8");
    assert.match(text, new RegExp(`shardFiles\\(${k}\\)`), `shard ${k} routes its own share`); // prettier-ignore
  }
});

test("deterministic, order-independent, and tidy — one sweep, three claims", () =>
  sweep());
