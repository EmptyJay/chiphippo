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

// rom-binding.js — flagging a ROM programmed, and what it does to the file it
// names.

import test from "node:test";
import assert from "node:assert/strict";

import { programmedPatch } from "../model/rom-binding.js";

const G = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

test("a fresh load names its file and clears an old edit mark", () => {
  const params = { storage: { guid: G, source: "/a.bin", edited: true } };
  assert.deepEqual(programmedPatch(params, true, { source: "/b.bin" }), {
    programmed: true,
    storage: { guid: G, source: "/b.bin" },
  });
  // A load from nowhere nameable forgets the old name.
  assert.deepEqual(programmedPatch(params, true, { source: null }), {
    programmed: true,
    storage: { guid: G },
  });
  assert.deepEqual(params.storage.source, "/a.bin", "the params are not touched"); // prettier-ignore
});

test("saved hand-edits keep the source and mark it", () => {
  const params = { storage: { guid: G, source: "/a.bin" } };
  assert.deepEqual(programmedPatch(params, true, { edited: true }), {
    programmed: true,
    storage: { guid: G, source: "/a.bin", edited: true },
  });
  // No binding: both halves left as they were.
  assert.deepEqual(programmedPatch(params, true), {
    programmed: true,
    storage: { guid: G, source: "/a.bin" },
  });
});

test("unprogrammed drops both halves; no storage, no storage patch", () => {
  const params = { storage: { guid: G, source: "/a.bin", edited: true } };
  assert.deepEqual(programmedPatch(params, false, { source: "/b.bin" }), {
    programmed: false,
    storage: { guid: G },
  });
  assert.deepEqual(programmedPatch({}, true, { edited: true }), { programmed: true }); // prettier-ignore
  assert.deepEqual(programmedPatch(undefined, "yes"), { programmed: false });
});
