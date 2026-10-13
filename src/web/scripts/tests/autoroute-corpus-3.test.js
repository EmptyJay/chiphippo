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

// autoroute-corpus-3.test.js — routing shard 3 of the auto-route corpus:
// its share of the shipped examples, each routed and held to the rules
// (autoroute-corpus.js says what, and why it is sharded).

import test from "node:test";

import { ROUTED, routesLegally, shardFiles } from "./autoroute-corpus.js";
import { FAST_SKIP } from "./test-depth.js";

for (const file of shardFiles(3)) {
  const skip = !ROUTED.has(file) && FAST_SKIP;
  test(
    `${file}: routes legally, and changes nothing electrical`,
    { skip },
    () => routesLegally(file),
  );
}
