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

// rom-binding.js — what flagging a ROM chip programmed does to its params: the
// ONE rule DeskController.setMemoryProgrammed applies to the desk, and the
// workspace applies to a desktop that is not on it (a write that came back
// after its desk was swapped out). Pure.

/**
 * The params patch for flagging a ROM `programmed` (or not), with `binding`:
 *   · `{ source }` — a fresh load. The path is recorded (null forgets it, so a
 *     label can never name a file that is not what the chip holds) and any
 *     `edited` mark is cleared: these ARE that file's bytes again.
 *   · `{ edited: true }` — hand-edits saved (the inspector's Save, the CPU
 *     monitor's kept run edits). The source is KEPT and marked.
 * Omitting a key leaves that half alone; `programmed: false` drops both, since
 * an unprogrammed chip holds noise and noise came from nowhere.
 * @param {object} params - the chip's params now
 * @param {boolean} programmed
 * @param {{source?: string|null, edited?: boolean}} [binding]
 * @returns {object} the patch (shallow — `storage` goes over whole)
 */
export function programmedPatch(params, programmed, binding = {}) {
  const patch = { programmed: programmed === true };
  const storage = params?.storage;
  if (storage) {
    // Shallow merges, so storage goes over whole or the guid — the one thing
    // that names the backing file — would be erased.
    const next = { ...storage };
    if (programmed !== true) {
      delete next.source;
      delete next.edited;
    } else {
      if (binding.source !== undefined) {
        if (binding.source) next.source = binding.source;
        else delete next.source;
        delete next.edited;
      }
      if (binding.edited === true) next.edited = true;
    }
    patch.storage = next;
  }
  return patch;
}
