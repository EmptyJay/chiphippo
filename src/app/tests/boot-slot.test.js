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

// What startup does with a working slot it could not READ (boot-slot.js),
// against a real ProjectStore: the work in it is never what goes.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { ProjectStore } = require("../store/project-store");
const { DeskStore } = require("../store/desk-store");
const { keepUnreadSlot } = require("../boot-slot");

/** A store whose working slot holds a recovery copy nobody can read. */
function unreadable(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chiphippo-boot-"));
  const store = new ProjectStore(dir, new DeskStore());
  try {
    const meta = store.newProject();
    store.write(store.defaultProjectPath, meta, { recoveryFor: "/x/Work.chiphippo" }); // prettier-ignore
    fs.chmodSync(store.defaultProjectPath, 0o000);
    fn(store, dir);
  } finally {
    for (const f of fs.readdirSync(path.join(dir, "saves"))) {
      fs.chmodSync(path.join(dir, "saves", f), 0o600);
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Root reads anything: there is no unreadable file to test with.
const asRoot = process.getuid?.() === 0;

test(
  "a slot that cannot be read throws on the FIRST look, not just the full read",
  { skip: asRoot },
  () => {
    unreadable((store) => {
      assert.throws(() => store.peekRecovery(), { code: "EACCES" });
      assert.throws(() => store.read(store.defaultProjectPath), { code: "EACCES" }); // prettier-ignore
    });
  },
);

test(
  "an unread slot is set aside, kept whole, and said where",
  { skip: asRoot },
  () => {
    unreadable((store) => {
      const notes = [];
      keepUnreadSlot(store, notes, new Error("EACCES"));
      assert.equal(
        store.hasDefaultProject(),
        false,
        "the slot is free for the boot",
      );
      assert.equal(notes.length, 1);
      assert.equal(notes[0].key, "workspace.slotAside", "facts, worded by the renderer"); // prettier-ignore
      const aside = notes[0].path;
      assert.ok(
        aside && fs.existsSync(aside),
        "the work is at the path the note names",
      );
      // What the boot does next cannot reach it.
      store.newProject();
      assert.ok(fs.existsSync(aside));
    });
  },
);

test(
  "a slot that cannot even be moved is HELD: nothing this session deletes it",
  { skip: asRoot },
  () => {
    unreadable((store) => {
      store.setAsideDefaultProject = () => {
        throw Object.assign(new Error("EPERM"), { code: "EPERM" });
      };
      const notes = [];
      keepUnreadSlot(store, notes, new Error("EACCES"));
      assert.deepEqual(notes, [{ key: "workspace.slotLeft", path: store.defaultProjectPath }]); // prettier-ignore
      store.newProject(); // the boot's fallback
      assert.equal(store.hasDefaultProject(), true, "still there");
      assert.equal(store.removeDefaultProject(), false);
    });
  },
);
