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

// spice/speakers.js — every speaker on a desk and what it plays. Pure and
// DOM-free. A speaker is a resistor to the solve (its coil — catalog/
// speaker.js `weakBridges`); what makes it a speaker is that the voltage
// across it is timed, at every settle (spice/engine.js `noteReadouts`), into
// a pitch (spice/measure.js `noteTone`), and the pitch and the power in its
// coil come back as the tick's `tones` for components/speaker-audio.js.

import { partDef } from "../../catalog/index.js";
import { speakerParams } from "../../catalog/speaker.js";
import { partPinAddresses } from "../../model/occupancy.js";
import { toneOf } from "./measure.js";

const TOPOLOGY = new WeakMap(); // netlist → its speakers

/**
 * Every speaker on a desk whose two legs are on nets: `[{id, a, b,
 * impedance, volume}]` — `a` its + leg's net, `b` its −. Once per netlist.
 * @param {object} doc
 * @param {{netOfPoint: Map}} netlist
 */
export function speakerTopology(doc, netlist) {
  const cached = TOPOLOGY.get(netlist);
  if (cached) return cached;
  const out = [];
  for (const comp of doc?.components ?? []) {
    if (comp.board == null || !partDef(comp.ref)?.speaker) continue;
    const pins = partPinAddresses(doc, comp);
    if (!pins) continue;
    const netOf = (pin) => {
      const at = pins.find((p) => p.pin === pin)?.address;
      return at ? (netlist.netOfPoint.get(at) ?? null) : null;
    };
    const a = netOf(1);
    const b = netOf(2);
    if (!a || !b || a === b) continue;
    const { impedance, volume } = speakerParams(comp.params);
    out.push({ id: comp.id, a, b, impedance, volume });
  }
  TOPOLOGY.set(netlist, out);
  return out;
}

/** A speaker's key in the timed voltages (`analog.tones`). */
export const toneKey = (id) => `spk:${id}`;

/**
 * What every speaker is playing at `now` (shown seconds): id → `{hz, vpp,
 * watts, volume}` — the pitch in true time, the swing across it, the power
 * that swing puts in its coil (a square's: half the swing, squared, over
 * its impedance) and its Volume setting. A silent speaker is not in it.
 * @param {Array<{id: string, impedance: number, volume: number}>} speakers
 * @param {Map<string, object>} tones - the `noteTone` marks
 * @param {number} now
 */
export function speakerTones(speakers, tones, now) {
  const out = new Map();
  for (const sp of speakers) {
    const tone = toneOf(tones.get(toneKey(sp.id)), now);
    if (!tone) continue;
    const watts = (tone.vpp / 2) ** 2 / sp.impedance;
    out.set(sp.id, { ...tone, watts, volume: sp.volume });
  }
  return out;
}
