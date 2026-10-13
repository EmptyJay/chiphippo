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

// speaker-audio.test.js — the speakers heard and drawn: components/speaker-
// audio.js plays each sim-state's tones (a fake Web Audio context records
// what it was asked), and the speaker's view lights its ring and says its
// pitch.

import test from "node:test";
import assert from "node:assert/strict";

import { resetDom } from "./jsdom-setup.js";
import { SPEAKER_FULL_W } from "../catalog/speaker.js";

const { AUDIBLE_HZ, HOLD_MS, MASTER_GAIN, SpeakerAudio, speakerSounds } =
  await import("../components/speaker-audio.js");
const { buildDiscreteSvg, DiscreteView, discreteBox } =
  await import("../components/discrete-view.js");

/** A Web Audio context that records what is made of it. */
function fakeContext() {
  const param = (value) => ({
    value,
    targets: [],
    setTargetAtTime(v) {
      this.targets.push(v);
    },
  });
  const ctx = {
    state: "running",
    currentTime: 0,
    destination: {},
    oscillators: [],
    resumed: 0,
    suspended: 0,
    resume() {
      ctx.resumed++;
      ctx.state = "running";
    },
    suspend() {
      ctx.suspended++;
      ctx.state = "suspended";
    },
    createOscillator() {
      const osc = {
        type: "sine",
        frequency: param(440),
        started: false,
        stoppedAt: null,
        onended: null,
        connect() {},
        disconnect() {},
        start() {
          osc.started = true;
        },
        stop(at) {
          osc.stoppedAt = at;
        },
      };
      ctx.oscillators.push(osc);
      return osc;
    },
    createGain() {
      return { gain: param(1), connect() {}, disconnect() {} };
    },
  };
  return ctx;
}

/** Timers run by hand. */
function fakeTimers() {
  let next = 1;
  const pending = new Map();
  return {
    setTimeout(fn, ms) {
      pending.set(next, { fn, ms });
      return next++;
    },
    clearTimeout(id) {
      pending.delete(id);
    },
    fire() {
      const all = [...pending.values()];
      pending.clear();
      for (const { fn } of all) fn();
    },
    get size() {
      return pending.size;
    },
  };
}

const tone = (hz, watts = SPEAKER_FULL_W, volume = 100) => ({ hz, vpp: 1, watts, volume }); // prettier-ignore
const running = (tones) => ({ running: true, tones: new Map(tones) });

test("speakerSounds: the pitch at the run's speed, the gain from the power and the Volume", () => {
  const out = speakerSounds(
    new Map([
      ["a", tone(440, SPEAKER_FULL_W / 4, 50)],
      ["low", tone(30)], // 7.5 Hz at a quarter: below hearing
      ["high", tone(20e3)], // fine at a quarter
      ["muted", tone(440, SPEAKER_FULL_W, 0)],
    ]),
    0.25,
  );
  assert.deepEqual([...out.keys()], ["a", "high"]);
  assert.equal(out.get("a").hz, 110);
  assert.equal(out.get("a").gain, 0.5 * 0.5 * MASTER_GAIN);
  assert.equal(out.get("high").hz, 5e3);
  assert.ok(speakerSounds(new Map([["x", tone(AUDIBLE_HZ.max * 1.01)]])).size === 0); // prettier-ignore
});

test("SpeakerAudio: a square voice per speaker, retuned in place, held then faded when its tone goes", () => {
  const ctx = fakeContext();
  const timers = fakeTimers();
  const audio = new SpeakerAudio({ makeContext: () => ctx, timers });
  audio.update(running([["ls1", tone(440)]]), 1);
  assert.equal(ctx.oscillators.length, 1);
  const [osc] = ctx.oscillators;
  assert.equal(osc.type, "square");
  assert.ok(osc.started);
  assert.deepEqual(osc.frequency.targets, [440]);
  // A new pitch glides the same voice there.
  audio.update(running([["ls1", tone(880)]]), 1);
  assert.equal(ctx.oscillators.length, 1);
  assert.deepEqual(osc.frequency.targets, [440, 880]);
  // Gone from one sim-state: held…
  audio.update(running([]), 1);
  assert.deepEqual(audio.playing, ["ls1"]);
  assert.equal(timers.size, 1);
  // …and back within the hold, it plays on with no new voice.
  audio.update(running([["ls1", tone(880)]]), 1);
  assert.equal(timers.size, 0);
  assert.equal(ctx.oscillators.length, 1);
  // Gone for good: faded and stopped once the hold runs out.
  audio.update(running([]), 1);
  timers.fire();
  assert.deepEqual(audio.playing, []);
  assert.ok(osc.stoppedAt != null);
  osc.onended();
  assert.equal(ctx.suspended, 1, "nothing playing: the context sleeps");
  // A new tone wakes it.
  audio.update(running([["ls2", tone(220)]]), 1);
  assert.equal(ctx.resumed, 1);
  assert.equal(ctx.oscillators.length, 2);
  assert.ok(HOLD_MS > 0);
});

test("SpeakerAudio: a stopped board is silence at once; no Web Audio, no sound and no error", () => {
  const ctx = fakeContext();
  const audio = new SpeakerAudio({ makeContext: () => ctx, timers: fakeTimers() }); // prettier-ignore
  audio.update(
    running([
      ["a", tone(440)],
      ["b", tone(660)],
    ]),
    4,
  );
  assert.deepEqual(ctx.oscillators.map((o) => o.frequency.targets[0]), [1760, 2640]); // prettier-ignore
  audio.update({ running: false, tones: new Map() });
  assert.deepEqual(audio.playing, []);
  assert.ok(ctx.oscillators.every((o) => o.stoppedAt != null));
  const none = new SpeakerAudio({ makeContext: () => null, timers: fakeTimers() }); // prettier-ignore
  none.update(running([["a", tone(440)]]), 1);
  assert.deepEqual(none.playing, []);
});

test("the speaker's view: a round can over its two legs, its ring lit and its pitch on its cone and in its hover while it plays", () => {
  resetDom();
  const svg = buildDiscreteSvg("speaker", { impedance: 16 });
  assert.ok(svg.querySelector(".part-speaker-body"));
  assert.match(svg.textContent, /16Ω/);
  // The can stands inside its box, and over both legs.
  const box = discreteBox("speaker");
  const body = svg.querySelector(".part-speaker-body");
  const [cx, cy, r] = ["cx", "cy", "r"].map((a) => Number(body.getAttribute(a))); // prettier-ignore
  assert.ok(cx - r >= box.minX && cx + r <= box.minX + box.width);
  assert.ok(cy - r >= box.minY && cy + r <= box.minY + box.height);
  assert.ok(Math.hypot(0 - cx, 0 - cy) < r && Math.hypot(3 - cx, 0 - cy) < r);
  const layer = document.createElement("div");
  const view = new DiscreteView(layer, { id: "ls1", ref: "speaker", params: {} }); // prettier-ignore
  const title = () => view.element.querySelector(".part-speaker-hit > title").textContent; // prettier-ignore
  view.setTone({ hz: 440, watts: 0.01, volume: 50 });
  assert.ok(view.element.classList.contains("part-discrete--playing"));
  assert.match(title(), /440/);
  const readout = () => view.element.querySelector(".part-speaker-hz").textContent; // prettier-ignore
  assert.equal(readout(), "440 Hz", "its pitch on its cone");
  view.setTone({ hz: 1385.2, watts: 0.01, volume: 50 });
  assert.equal(readout(), "1.39 kHz");
  view.setTone(null);
  assert.ok(!view.element.classList.contains("part-discrete--playing"));
  assert.equal(title(), "");
  assert.equal(readout(), "", "blank while silent");
});
