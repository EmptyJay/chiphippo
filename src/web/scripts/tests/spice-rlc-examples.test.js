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

// The passives' examples, proved: the SHIPPED desktops of the
// cap-electrolytic example (demos/rc.chiphippo — an LED fade and a Schmitt
// timer) and the inductor's (demos/lc.chiphippo — a series RLC ringing) run
// under Spice Lite as SimController runs them — clocks toggling at their
// edges, a switch flipped or a button held by rebuilding the netlist — and
// each is held to its closed form, every figure computed from the parts' own
// values on the desk. engine-parity.test.js exempts them (the logic engine
// runs a capacitor as nothing and a coil as a wire); this is their proof.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { ENGINES } from "../sim/engines.js";
import { buildNetlist } from "../sim/netlist.js";
import { H, L } from "../sim/levels.js";
import { sampleAnalog } from "../sim/spice/sample.js";
import { partDef } from "../catalog/index.js";
import { inductorOhms } from "../catalog/discretes.js";
import { exampleDesktops } from "../model/example-desktops.js";

const DEMOS = fileURLToPath(new URL("../../demos/", import.meta.url));
const VDD = 5;

/** One shipped example desktop's document, by part ref and desktop name. */
function exampleDoc(ref, name) {
  const payload = JSON.parse(readFileSync(`${DEMOS}${ref}.json`, "utf8"));
  const desk = exampleDesktops(ref, payload).find(
    (d) => d.name === `${ref} ${name} example`,
  );
  assert.ok(desk, `${ref} has a ${name} desktop`);
  return structuredClone(desk.doc);
}

/** The one part of `ref` on the desk (or the one whose params match). */
function only(doc, ref, match = () => true) {
  const found = doc.components.filter((c) => c.ref === ref && match(c));
  assert.equal(found.length, 1, `one ${ref}`);
  return found[0];
}

/** The hole a part's pin `n` is seated in. */
function pinAt(comp, n) {
  const offsets = partDef(comp.ref).footprint.offsets;
  const m = /^([a-j])(\d+)$/.exec(comp.anchor);
  return `${comp.board}.${m[1]}${Number(m[2]) + offsets[n - 1]}`;
}

/**
 * A desk run under Spice Lite the way SimController runs it: every clock
 * toggled at its own edges (idle LOW at 0), a part's params or a button's
 * press a netlist rebuilt and a tick at that moment, and between ticks the
 * analog curves read where they stand (`sampleAnalog`).
 */
function spiceRun(doc) {
  const { tick } = ENGINES.spice;
  let pressed = new Map();
  const build = () => buildNetlist(doc, pressed, { inductors: "branch" });
  let netlist = build();
  let warm = new Map();
  let state = new Map();
  let prev = new Map();
  let analog = null;
  let last = null;
  let now = 0;
  const clocks = doc.components.filter((c) => c.kind === "clock");
  const half = (c) => 0.5 / c.params.hz;
  const phase = new Map(clocks.map((c) => [c.id, L]));
  const since = new Map(clocks.map((c) => [c.id, 0]));
  const edge = new Map(clocks.map((c) => [c.id, half(c)]));
  const run = (t) => {
    last = tick({
      document: doc,
      netlist,
      warmStart: warm,
      state,
      prevPinLevels: prev,
      clockPhase: phase,
      clockTimes: new Map(
        clocks.map((c) => [c.id, { half: half(c), since: since.get(c.id) }]),
      ),
      signalLevels: new Map(),
      now: t,
      spice: { config: { enabled: true }, analog },
    });
    warm = last.netLevels;
    state = last.state;
    prev = last.pinLevels;
    analog = last.analog ?? null;
    now = t;
  };
  const netOf = (address) => netlist.netOfPoint.get(address);
  run(0);
  return {
    get result() {
      return last;
    },
    /** A slide switch thrown, a value changed: what a doc change does. */
    set(id, params) {
      const comp = doc.components.find((c) => c.id === id);
      comp.params = { ...comp.params, ...params };
      netlist = build();
      run(now);
    },
    /** A momentary button pressed or let go. */
    press(id, down) {
      pressed = new Map(down ? [[id, { pressed: true }]] : []);
      netlist = build();
      run(now);
    },
    /** The volts at `address` on the last tick. */
    volts(address) {
      return last.nodeVolts.get(netOf(address));
    },
    /**
     * Run on to `until`, ticking at every wake and clock edge; `each(t, v)`
     * is called after every tick and every `dt` between, `v(address)` the
     * voltage there at `t`.
     */
    advance(until, dt, each = null) {
      while (now < until) {
        const at = Math.min(until, last.wakeAt ?? Infinity, ...edge.values());
        if (each) {
          for (let t = now + dt; t < at - 1e-12; t += dt) {
            const { volts } = sampleAnalog(last.analog, t);
            each(t, (a) => volts.get(netOf(a)) ?? last.nodeVolts.get(netOf(a)));
          }
        }
        for (const c of clocks) {
          if (Math.abs(edge.get(c.id) - at) > 1e-12) continue;
          phase.set(c.id, phase.get(c.id) === H ? L : H);
          since.set(c.id, at);
          edge.set(c.id, at + half(c));
        }
        run(at);
        each?.(now, (a) => last.nodeVolts.get(netOf(a)));
      }
    },
  };
}

const near = (got, want, rel, what) =>
  assert.ok(
    Math.abs(got - want) <= rel * Math.abs(want),
    `${what}: ${got}, want ${want} ±${rel * 100} %`,
  );

test("RC timer: the capacitor charges along τ = RC and the Schmitt input trips at its thresholds", () => {
  const doc = exampleDoc("cap-electrolytic", "Timer");
  const sw = only(doc, "sw-slide");
  const cap = only(doc, "cap-electrolytic");
  const r = only(doc, "resistor", (c) => c.params.ohms === 10e3);
  const led = only(doc, "led", (c) => c.params.color === "green");
  const { upV, downV } = partDef("CD40106B").schmitt;
  const tau = r.params.ohms * cap.params.farads;
  const node = pinAt(cap, 1);

  const sim = spiceRun(doc);
  assert.equal(sim.result.lamps.get(led.id).lit, false, "discharged: off");
  sim.set(sw.id, { pos: "2" }); // to +5 V at t = 0
  let litAt = null;
  const onWatch = (t) => {
    if (litAt == null && sim.result.lamps.get(led.id).lit) litAt = t;
  };
  sim.advance(tau, tau / 100, onWatch); // ends on a tick at τ itself
  near(sim.volts(node), VDD * (1 - Math.exp(-1)), 0.005, "the capacitor one τ in"); // prettier-ignore
  sim.advance(5 * tau, tau / 100, onWatch);
  near(litAt, tau * Math.log(VDD / (VDD - upV)), 0.01, "the LED's delay on");

  const start = sim.volts(node);
  const t0 = 5 * tau;
  sim.set(sw.id, { pos: "1" }); // back to GND
  let darkAt = null;
  sim.advance(t0 + 3 * tau, tau / 100, (t) => {
    if (darkAt == null && !sim.result.lamps.get(led.id).lit) darkAt = t - t0;
  });
  near(darkAt, tau * Math.log(start / downV), 0.01, "the LED's delay off");
});

test("RC fade: each LED stays lit in proportion to its capacitor", () => {
  const doc = exampleDoc("cap-electrolytic", "Fade");
  const button = only(doc, "sw-push");
  const caps = doc.components.filter((c) => c.ref === "cap-electrolytic");
  const leds = doc.components.filter((c) => c.ref === "led");
  assert.equal(caps.length, 2);
  // The layout seats each branch's capacitor before its LED, so the two
  // lists pair up in order.
  const sim = spiceRun(doc);
  sim.press(button.id, true);
  sim.advance(1, 0.1);
  const charged = caps.map((c) => sim.volts(pinAt(c, 1)));
  near(charged[0], charged[1], 0.001, "both charged to the same voltage");
  for (const l of leds) assert.ok(sim.result.lamps.get(l.id).lit, "lit");
  sim.press(button.id, false);
  const dark = new Map();
  sim.advance(15, 0.05, (t) => {
    for (const l of leds) {
      if (!dark.has(l.id) && !sim.result.lamps.get(l.id).lit) dark.set(l.id, t - 1); // prettier-ignore
    }
  });
  assert.equal(dark.size, 2, "both LEDs go out");
  const [big, small] = caps[0].params.farads > caps[1].params.farads ? [0, 1] : [1, 0]; // prettier-ignore
  near(
    dark.get(leds[big].id) / dark.get(leds[small].id),
    caps[big].params.farads / caps[small].params.farads,
    0.01,
    "the ratio of the LEDs' fade times",
  );
  // And the figures the desk's own caption quotes. The LED's forward voltage
  // gives these no closed form (only the ratio has one, above), so they are
  // held to what the caption says — a change to the engine's time or the
  // LED's curve that moves them must move the caption too.
  near(charged[0], 3.91, 0.02, "the charge the caption reads (5 V less the diode and the 100 Ω)"); // prettier-ignore
  near(dark.get(leds[big].id), 6.4, 0.03, "the 1000 µF LED's fade the caption quotes"); // prettier-ignore
  near(dark.get(leds[small].id), 1.4, 0.03, "the 220 µF LED's fade the caption quotes"); // prettier-ignore
});

test("LC ringing: a series RLC step rings at ω₀√(1 − ζ²) and overshoots by exp(−πζ/√(1 − ζ²))", () => {
  const doc = exampleDoc("inductor", "Ringing");
  const coil = only(doc, "inductor");
  const cap = only(doc, "cap-ceramic");
  const counter = only(doc, "CD4040B");
  const q10 = `${counter.board}.f${Number(counter.anchor.slice(1)) + 2}`; // pin 14
  const nodeA = pinAt(coil, 1);
  const nodeC = pinAt(cap, 1);
  // The divider is every resistor with a lead on A: the one from Q10, and
  // the ones to the rails.
  const wiring = buildNetlist(doc);
  const netOf = (address) => wiring.netOfPoint.get(address);
  const divider = doc.components
    .filter((c) => c.ref === "resistor")
    .map((c) => ({
      ohms: c.params.ohms,
      nets: [1, 2].map((n) => netOf(pinAt(c, n))),
    })) // prettier-ignore
    .filter((r) => r.nets.includes(netOf(nodeA)));
  const fromQ = divider.filter((r) => r.nets.includes(netOf(q10)));
  assert.equal(fromQ.length, 1, "one resistor from Q10 to A");
  const toRails = divider.filter((r) => r !== fromQ[0]);
  assert.equal(toRails.length, 2, "and one to each rail");
  const henries = coil.params.henries;
  const farads = cap.params.farads;

  const sim = spiceRun(doc);
  // Q10 (÷1024 of 1 kHz) first rises at 512 ms; settle there, then step.
  sim.advance(0.511, 1e-3);
  const before = sim.volts(nodeA);
  const rows = [];
  sim.advance(0.62, 1e-4, (t, v) => rows.push([t, v(nodeC), v(nodeA), v(q10)]));
  const stepAt = rows.find(([, , a]) => a - before > 0.5)[0];
  const [, settled, finalA, qHigh] = rows.at(-1);
  const step = finalA - before;
  near(settled, finalA, 0.002, "the capacitor settles on A");

  // The drive's own resistance: the divider's Thevenin with the CD4040B's
  // output resistance (read off Q10 sagging under its load) in series.
  const r1 = fromQ[0].ohms;
  const iQ = (qHigh - finalA) / r1;
  const rOut = (VDD - qHigh) / iQ;
  const rDrive = 1 / toRails.reduce((g, r) => g + 1 / r.ohms, 1 / (r1 + rOut));
  const ohms = inductorOhms(coil.params) + rDrive;
  const w0 = 1 / Math.sqrt(henries * farads);
  const zeta = (ohms / 2) * Math.sqrt(farads / henries);
  const wd = w0 * Math.sqrt(1 - zeta * zeta);

  // The period: successive upward crossings of the final value.
  const ring = rows.filter(([t]) => t >= stepAt);
  const ups = [];
  for (let i = 1; i < ring.length; i++) {
    const [t0, v0] = ring[i - 1];
    const [t1, v1] = ring[i];
    if (v0 < settled && v1 >= settled) {
      ups.push(t0 + ((settled - v0) / (v1 - v0)) * (t1 - t0));
    }
  }
  assert.ok(ups.length >= 2, "it rings");
  near(ups[1] - ups[0], (2 * Math.PI) / wd, 0.005, "the ring's period");

  const peak = Math.max(...ring.map(([, v]) => v));
  near(
    (peak - finalA) / step,
    Math.exp((-Math.PI * zeta) / Math.sqrt(1 - zeta * zeta)),
    0.01,
    "the first overshoot",
  );
});
