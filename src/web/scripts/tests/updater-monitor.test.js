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

// updater-monitor.test.js — the updater's toasts (components/updater-monitor.js):
// a Restart that did not restart is said, in the one updater slot.

import test from "node:test";
import assert from "node:assert/strict";

import { resetDom } from "./jsdom-setup.js";

const { UpdaterMonitor } = await import("../components/updater-monitor.js");

test("an install that did not happen says so, replacing the Restart offer", () => {
  resetDom();
  const shown = [];
  const dismissed = [];
  new UpdaterMonitor({
    notify: (o) => shown.push(o),
    dismiss: (key) => dismissed.push(key),
  });
  const push = (name, detail = {}) =>
    window.dispatchEvent(new CustomEvent(`chiphippo:updater-${name}`, { detail })); // prettier-ignore
  push("downloaded", { version: "9.9.9" });
  assert.equal(shown.at(-1).actionLabel, "Restart");
  push("install-failed");
  const toast = shown.at(-1);
  assert.equal(toast.variant, "warning");
  assert.equal(toast.title, "Update not installed");
  assert.match(toast.message, /still open on this version/);
  assert.equal(toast.key, "updater", "the same slot as the offer");
  assert.equal(toast.sticky, true);
  assert.equal(toast.actionLabel, "Restart", "and the offer stands");
  assert.deepEqual(dismissed, ["updater", "updater"]);
});
