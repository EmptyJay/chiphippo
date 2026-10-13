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

// boot-slot.js — what startup does with a working slot it could not READ
// (main.js `openBootProject`). Its own module so it tests without Electron.
"use strict";

/**
 * The working slot is THERE and could not be read — an I/O failure, not a
 * damaged file (that reads as null, set aside by io.readJSON). NOT READ is not
 * unreadable: it says nothing about the work in it, which may be the only
 * copy, and the boot that follows would take the slot over (a new project
 * deletes it; a recent project's autosave writes over it). So it is moved
 * aside, never deleted — and if even that fails, HELD where it is (nothing
 * this session writes or removes it; the next launch reads it again). Either
 * way the user is told where it is — as FACTS, `{key, path}`, which the
 * renderer words in the user's language (ProjectWorkspace `#warn`).
 */
function keepUnreadSlot(store, notes, err) {
  console.error("[main] project:boot: the working slot could not be read:", err && err.message); // prettier-ignore
  let aside = null;
  try {
    aside = store.setAsideDefaultProject();
  } catch (moveErr) {
    console.error("[main] project:boot: could not set it aside:", moveErr && moveErr.message); // prettier-ignore
    store.holdDefaultProject();
    notes.push({ key: "workspace.slotLeft", path: store.defaultProjectPath });
    return;
  }
  // (Null: the file went between the failed read and the move — nothing to keep.)
  if (aside) {
    notes.push({ key: "workspace.slotAside", path: aside });
  }
}

module.exports = { keepUnreadSlot };
