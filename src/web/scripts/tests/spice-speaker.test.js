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

// spice-speaker.test.js — the speaker under Spice Lite: the voltage across
// it timed into the tone it plays (spice/measure.js `noteTone`, spice/
// speakers.js), held to the 555 driving it — its own measured readout, the
// same edges — at a rate the desk steps edge by edge and at rates drawn by
// their schedule; its loudness to the power its swing puts in its coil; and
// silence where there is no tone.

import test from "node:test";
import assert from "node:assert/strict";

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { ENGINES } from "../sim/engines.js";
import { buildNetlist } from "../sim/netlist.js";
import { H, L } from "../sim/levels.js";
import { exampleDesktops } from "../model/example-desktops.js";
import { TONE_MIN_VPP, noteTone, toneOf } from "../sim/spice/measure.js";
import { speakerTones, toneKey } from "../sim/spice/speakers.js";
import { SPEAKER_FULL_W, speakerLoudness, speakerParams } from "../catalog/speaker.js"; // prettier-ignore
import { partDef } from "../catalog/index.js";
import { astable555, runner } from "./timing-fixtures.js";
import { MIN_SHOWN_S } from "../sim/timing.js";

/**
 * A 555 astable (RA, RB, C) whose OUT drives a speaker through `series` Ω
 * and a `coupling` capacitor (+ to the 555's side) — the example's circuit —
 * or, with `coupling` null, straight through the resistor.
 */
function toneBench({
  ra = 1e3,
  rb = 15e3,
  c = 100e-9,
  series = 47,
  coupling = 100e-6,
  impedance = 8,
  reset = true,
} = {}) {
  // prettier-ignore
  const { doc, b, u } = astable555({ ra, rb, c, reset });
  const r = b.seat("r3", "resistor", "a55", { ohms: series });
  b.link(r.get(1), u.get(3));
  const sp = b.seat("ls1", "speaker", "a60", { impedance });
  if (coupling) {
    const cc = b.seat("c3", "cap-electrolytic", "a5", { farads: coupling });
    b.link(cc.get(1), r.get(2));
    b.link(sp.get(1), cc.get(2));
  } else b.link(sp.get(1), r.get(2));
  b.gnd(sp.get(2));
  return { doc, b, u };
}

/** Run a desk to `until`, ticking at every wake — no sooner than
    MIN_SHOWN_S after the last tick, as SimController does, so a tick spans
    the crossings a fast cycle is recognised by — and every frame it asks
    for; `signals(t)` the signal levels at `t`. The last result. */
function runTo(sim, until, signals = () => new Map()) {
  let r = sim.run(0, signals(0)).result;
  let t = 0;
  for (let n = 0; n < 50000; n++) {
    const next = r.wakeAt != null ? Math.max(r.wakeAt, t + MIN_SHOWN_S) : r.frameAt; // prettier-ignore
    if (next == null || next > until) break;
    t = Math.max(next, t + 1e-7);
    r = sim.run(t, signals(t)).result;
  }
  return sim.run(until, signals(until)).result;
}

const spice = (doc) => runner(doc, { engine: "spice", spice: {} });

const close = (actual, expected, rel, what) =>
  assert.ok(
    Math.abs(actual - expected) <= Math.abs(expected) * rel,
    `${what}: ${actual} vs ${expected}`,
  );

test("a speaker on a 555 plays the 555's own rate — stepped edge by edge, and drawn by its schedule", () => {
  // ~456 Hz (stepped), ~4.6 kHz and ~20 kHz (past the desk's 1 kHz, drawn).
  for (const c of [100e-9, 10e-9, 2.2e-9]) {
    const { doc } = toneBench({ c });
    const r = runTo(spice(doc), c < 5e-9 ? 0.06 : 0.2);
    const tone = r.tones.get("ls1");
    assert.ok(tone, `${c} F: it plays`);
    // Past ~2.5 kHz a tick spans whole cycles, and the 555's is drawn.
    assert.equal(r.analog.cycles.size > 0, c < 50e-9, `${c} F: drawn`);
    const rate = r.timing.get("u1").sections[0].frequency;
    close(tone.hz, rate, 1e-9, `${c} F: the 555's measured rate`);
    close(tone.hz, 1.44 / ((1e3 + 2 * 15e3) * c), 0.05, `${c} F: the sheet's rate`); // prettier-ignore
    // Its coil gets a square's power: half the swing, squared, over 8 Ω.
    close(tone.watts, (tone.vpp / 2) ** 2 / 8, 1e-12, `${c} F: watts`);
    assert.equal(tone.volume, 50);
    assert.deepEqual(r.warnings, []);
  }
});

test("the swing across it is the 555's step, divided between the resistor and the coil", () => {
  const { doc } = toneBench();
  const r = runTo(spice(doc), 0.3);
  const tone = r.tones.get("ls1");
  // Through 100 µF (τ = 55 Ω · 100 µF = 5.5 ms, 2.5 half-periods), the
  // speaker sees most of each edge: 8/(47 + 8) of a 3–3.5 V step, a little
  // sagged.
  assert.ok(tone.vpp > 0.4 && tone.vpp < 0.6, `${tone.vpp} V p-p`);
  // DC-coupled through 220 Ω, the whole of each step, never below 0.
  const dc = runTo(spice(toneBench({ coupling: null, series: 220 }).doc), 0.2);
  const t = dc.tones.get("ls1");
  close(t.hz, tone.hz, 1e-6, "the same rate");
  assert.ok(t.vpp > 0.08 && t.vpp < 0.14, `${t.vpp} V p-p`);
});

test("its impedance takes its share of the step, and its power from it", () => {
  const eight = runTo(spice(toneBench().doc), 0.3).tones.get("ls1");
  const thirtyTwo = runTo(spice(toneBench({ impedance: 32 }).doc), 0.3).tones.get("ls1"); // prettier-ignore
  // 32/(47 + 32) of each step against 8/(47 + 8) (the 555's own output
  // resistance aside, and the coupling's sag a little less).
  close(thirtyTwo.vpp / eight.vpp, 32 / 79 / (8 / 55), 0.06, "the divider");
  close(thirtyTwo.watts, (thirtyTwo.vpp / 2) ** 2 / 32, 1e-12, "its power");
});

test("a speaker with no tone across it is silent: an oscillator held in reset, one stopped", () => {
  // RESET grounded: nothing oscillates.
  const held = toneBench({ reset: false });
  held.b.gnd(held.u.get(4));
  assert.equal(runTo(spice(held.doc), 0.1).tones.size, 0);
  // RESET on a signal: playing while it is HIGH, silent soon after it drops.
  const keyed = toneBench({ reset: false });
  keyed.b.signal("s1", keyed.u.get(4), "high");
  const sim = spice(keyed.doc);
  const level = (until) => (t) => new Map([["s1", t < until ? H : L]]);
  assert.ok(runTo(sim, 0.1, level(1)).tones.has("ls1"), "playing");
  const keyedOff = spice(keyed.doc);
  assert.equal(runTo(keyedOff, 0.2, level(0.1)).tones.size, 0, "stopped");
});

test("the logic engine has no voltages to time: no tones", () => {
  const { doc } = toneBench();
  const sim = runner(doc, { engine: "digital" });
  const r = sim.run(0.01).result;
  assert.equal(r.tones, undefined);
});

test("noteTone: a square read at its edges, its rate in true time", () => {
  const tones = new Map();
  // 100 Hz, ±0.25 V, read at each edge and twice between (a sag).
  for (let k = 0; k < 40; k++) {
    const t = k * 0.005;
    const v = k % 2 ? -0.25 : 0.25;
    noteTone(tones, "x", v, t, 2); // each shown second two true ones
    noteTone(tones, "x", v * 0.9, t + 0.002, 2);
  }
  const tone = toneOf(tones.get("x"), 0.2);
  close(tone.hz, 200, 1e-9, "shown 100 Hz is 200 Hz true");
  close(tone.vpp, 0.5, 1e-9, "the swing");
  // Long after its last rise it has stopped.
  assert.equal(toneOf(tones.get("x"), 1), null);
});

test("noteTone: too small a swing is silence, and a quieter tone is heard again", () => {
  const tones = new Map();
  for (let k = 0; k < 20; k++) noteTone(tones, "x", (k % 2) * TONE_MIN_VPP * 0.5, k * 0.001); // prettier-ignore
  assert.equal(toneOf(tones.get("x"), 0.02), null, "under TONE_MIN_VPP");
  // Loud, then — after a pause long enough to count as stopped — ten
  // times quieter about another level.
  const m = new Map();
  let t = 0;
  for (let k = 0; k < 20; k++, t += 0.001) noteTone(m, "y", k % 2 ? 0 : 2, t);
  assert.ok(toneOf(m.get("y"), t), "loud");
  t += 0.05;
  for (let k = 0; k < 40; k++, t += 0.002) noteTone(m, "y", 1 + (k % 2 ? 0 : 0.2), t); // prettier-ignore
  const quiet = toneOf(m.get("y"), t);
  assert.ok(quiet, "heard again");
  close(quiet.hz, 250, 1e-9, "its own rate");
  close(quiet.vpp, 0.2, 1e-9, "its own swing");
});

test("speakerTones: only a speaker playing, with its power and its Volume", () => {
  const tones = new Map();
  for (let k = 0; k < 10; k++) noteTone(tones, toneKey("a"), k % 2 ? -0.5 : 0.5, k * 0.001); // prettier-ignore
  const out = speakerTones(
    [
      { id: "a", impedance: 16, volume: 80 },
      { id: "b", impedance: 8, volume: 50 },
    ],
    tones,
    0.01,
  );
  assert.deepEqual([...out.keys()], ["a"]);
  const a = out.get("a");
  close(a.hz, 500, 1e-9, "hz");
  close(a.watts, 0.5 ** 2 / 16, 1e-12, "watts");
  assert.equal(a.volume, 80);
});

test("the speaker part: a resistor of its impedance to the solve, Spice Lite's alone", () => {
  const def = partDef("speaker");
  assert.equal(def.spiceOnly, true);
  assert.equal(def.speaker, true);
  assert.deepEqual(def.internalBridges(), []);
  assert.deepEqual(def.weakBridges({ impedance: 32 }), [[1, 2, 32]]);
  assert.deepEqual(speakerParams({}), { impedance: 8, volume: 50 });
  assert.deepEqual(speakerParams({ impedance: 12, volume: 140.4 }), { impedance: 8, volume: 100 }); // prettier-ignore
  // Loudness: the square root of the power against full, times the Volume.
  close(
    speakerLoudness(SPEAKER_FULL_W / 4, 100),
    0.5,
    1e-12,
    "a quarter the power",
  );
  assert.equal(speakerLoudness(SPEAKER_FULL_W * 9, 40), 0.4);
  assert.equal(speakerLoudness(0.01, 0), 0);
});

// ── The shipped examples (demos/speaker.chiphippo) ─────────────────────────

const DEMOS = fileURLToPath(new URL("../../demos/", import.meta.url));

/** One shipped speaker example desktop's document, by name. */
function exampleDoc(name) {
  const payload = JSON.parse(readFileSync(`${DEMOS}speaker.json`, "utf8"));
  const desk = exampleDesktops("speaker", payload).find((d) => d.name === `speaker ${name} example`); // prettier-ignore
  assert.ok(desk, `a ${name} desktop`);
  return structuredClone(desk.doc);
}

/** The one part of `ref` on a desk (the nth, in document order). */
const nth = (doc, ref, n = 0) => doc.components.filter((c) => c.ref === ref)[n]; // prettier-ignore

/**
 * A desk run under Spice Lite as SimController runs it: a tick at every wake
 * and frame, a param changed or a button pressed by rebuilding the netlist.
 * `until(t, each)` runs on to `t`, calling `each(result)` after every tick.
 */
function deskRun(doc) {
  const { tick } = ENGINES.spice;
  let pressed = new Map();
  const build = () => buildNetlist(doc, pressed, { inductors: "branch" });
  let netlist = build();
  let carry = { warm: new Map(), state: new Map(), prev: new Map(), analog: null }; // prettier-ignore
  let last = null;
  let now = 0;
  const run = (t) => {
    last = tick({
      document: doc,
      netlist,
      warmStart: carry.warm,
      state: carry.state,
      prevPinLevels: carry.prev,
      clockPhase: new Map(),
      clockTimes: new Map(),
      signalLevels: new Map(),
      now: t,
      spice: { config: { enabled: true }, analog: carry.analog },
    });
    carry = { warm: last.netLevels, state: last.state, prev: last.pinLevels, analog: last.analog ?? null }; // prettier-ignore
    now = t;
  };
  run(0);
  return {
    get result() {
      return last;
    },
    set(id, params) {
      const comp = doc.components.find((c) => c.id === id);
      comp.params = { ...comp.params, ...params };
      netlist = build();
      run(now);
    },
    press(id, down) {
      pressed = new Map(down ? [[id, { pressed: true }]] : []);
      netlist = build();
      run(now);
    },
    until(t, each = null) {
      for (let n = 0; n < 200000 && now < t; n++) {
        const wake = last.wakeAt != null ? Math.max(last.wakeAt, now + MIN_SHOWN_S) : null; // prettier-ignore
        const next = Math.min(t, wake ?? last.frameAt ?? t);
        run(Math.max(next, now + 1e-7));
        each?.(last);
      }
    },
  };
}

/** The 555 astable's rate from its parts, Hz: 1.44 / ((RA + 2·RB)·C). */
const rate555 = (ra, rb, c) => 1.44 / ((ra + 2 * rb) * c);

test("example Tone: the speaker plays the 555's rate from its parts, and nothing warns", () => {
  const doc = exampleDoc("Tone");
  const sim = deskRun(doc);
  sim.until(0.3);
  const speaker = nth(doc, "speaker");
  const tone = sim.result.tones.get(speaker.id);
  assert.ok(tone, "it plays");
  const [ra, rb] = [0, 1].map((n) => nth(doc, "resistor", n).params.ohms);
  const c = nth(doc, "cap-ceramic").params.farads;
  close(tone.hz, rate555(ra, rb, c), 0.03, "f = 1.44/((RA + 2RB)C)");
  close(tone.hz, sim.result.timing.get(nth(doc, "NE555").id).sections[0].frequency, 1e-9, "the 555's own readout"); // prettier-ignore
  assert.ok(tone.watts > 0.005 && tone.watts < 0.05, `${tone.watts} W: audible, and well inside 0.5 W`); // prettier-ignore
  assert.deepEqual(sim.result.warnings, []);
});

test("example Pitch: the pot's Position sets the pitch while it plays", () => {
  const doc = exampleDoc("Pitch");
  const sim = deskRun(doc);
  const pot = nth(doc, "pot");
  const ra = nth(doc, "resistor").params.ohms;
  const c = nth(doc, "cap-ceramic").params.farads;
  const speaker = nth(doc, "speaker").id;
  let t = 0.3;
  sim.until(t);
  for (const position of [30, 50, 100, 10]) {
    if (position !== pot.params.position) sim.set(pot.id, { position });
    sim.until((t += 0.3));
    const rb = (pot.params.ohms * position) / 100;
    const tone = sim.result.tones.get(speaker);
    assert.ok(tone, `${position} %: it plays`);
    close(tone.hz, rate555(ra, rb, c), 0.04, `${position} %`);
  }
  assert.deepEqual(sim.result.warnings, []);
});

test("example Key: silent until the button is held, the tone while it is, silent once let go", () => {
  const doc = exampleDoc("Key");
  const sim = deskRun(doc);
  const speaker = nth(doc, "speaker").id;
  const button = nth(doc, "sw-push").id;
  sim.until(0.2);
  assert.equal(sim.result.tones.size, 0, "held in reset");
  sim.press(button, true);
  sim.until(0.4);
  const tone = sim.result.tones.get(speaker);
  assert.ok(tone, "keyed: it plays");
  const [ra, rb] = [0, 1].map((n) => nth(doc, "resistor", n).params.ohms);
  close(tone.hz, rate555(ra, rb, nth(doc, "cap-ceramic").params.farads), 0.03, "its rate"); // prettier-ignore
  sim.press(button, false);
  sim.until(0.6);
  assert.equal(sim.result.tones.size, 0, "let go: silent");
  assert.deepEqual(sim.result.warnings, []);
});

test("example Siren: the tone steps between two pitches a fourth apart, once a second", () => {
  const doc = exampleDoc("Siren");
  const sim = deskRun(doc);
  const speaker = nth(doc, "speaker").id;
  const heard = [];
  sim.until(4, (r) => {
    const hz = r.tones.get(speaker)?.hz;
    if (hz && (!heard.length || Math.abs(heard.at(-1).hz - hz) > 1)) heard.push({ t: r.analog.time, hz }); // prettier-ignore
  });
  // What it held for more than a few periods (each step's own period, the
  // one the threshold moved in, is neither pitch), from 1.5 s on.
  const held = heard
    .map((h, i) => ({ ...h, until: heard[i + 1]?.t ?? 4 }))
    .filter((h) => h.t > 1.5 && h.until - h.t > 0.02);
  const low = Math.min(...held.map((h) => h.hz));
  const high = Math.max(...held.map((h) => h.hz));
  // Two pitches only (a step, not a glide)…
  for (const h of held) {
    assert.ok(Math.abs(h.hz - low) < 0.01 * low || Math.abs(h.hz - high) < 0.01 * high, `${h.hz} Hz is one of the two`); // prettier-ignore
  }
  // …a fourth or so apart (4/3), each held about half a second.
  assert.ok(high / low > 1.25 && high / low < 1.45, `${low} → ${high} Hz`);
  assert.ok(held.length >= 4, `${held.length} pitches held in 2.5 s`);
  for (const h of held.slice(0, -1)) {
    assert.ok(h.until - h.t > 0.35 && h.until - h.t < 0.7, `held ${h.until - h.t} s`); // prettier-ignore
  }
  assert.deepEqual(sim.result.warnings, []);
});
