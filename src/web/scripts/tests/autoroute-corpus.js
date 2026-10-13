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

// autoroute-corpus.js — the shared half of the auto-route corpus (Feature
// 360): every SHIPPED example circuit routed end to end and held to the rules.
// The tests are SHARDED across autoroute-corpus-<n>.test.js (the routing) and
// autoroute-corpus-sweep.test.js (determinism and quality), because as one
// file it was the suite's slowest by far — three minutes alone, and in a full
// `make test`, sharing the cores with every other file, past the per-file
// timeout (a release failed on it, 2026-10-11). Each shard is its own process,
// so they run side by side and none is a long pole.
//
// The scenario tests in autoroute.test.js each build one situation and check one
// property. This is the opposite: every shipped example — real, densely-wired
// boards that nobody wrote for the router — run through it end to end. It is
// the same trick `autobuild-corpus.test.js` plays on the compiler, and for the
// same reason — the demos are a free corpus of circuits with no API key, no
// network and no hand-maintained fixtures behind them.
//
// What it holds:
//   · no route leaves the legal region, ever;
//   · no route enters a part it does not end on;
//   · no route exceeds the file format's twenty waypoints;
//   · THE NETLIST IS UNCHANGED — the claim that makes a one-click rewrite of
//     every wire on the desk a safe thing to offer at all;
//   · the routes survive a save/load round trip byte for byte;
//   · and it is deterministic, including against the order the wires arrive in.
//
// A FAST run (`make test-fast`, test-depth.js) routes every twelfth board and
// sweeps two; the rest are reported as skipped. `make test` routes every one.

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { DeskDoc } from "../model/desk-doc.js";
import { buildNetlist } from "../sim/netlist.js";
import { buildOccupancy } from "../model/occupancy.js";
import { addressWorld } from "../model/part-geometry.js";
import { MAX_WIRE_POINTS } from "../model/desk-doc.js";
import { OUTSIDE } from "../model/route-space.js";
import { SKIP_BUS_MEMBER, routeDesk, routePlan } from "../model/autoroute.js";
import { ROUTE_CONFIG } from "../model/route-config.js";
import { exampleDesktops } from "../model/example-desktops.js";
import { FAST, sampled } from "./test-depth.js";

export const DIR = fileURLToPath(new URL("../../demos/", import.meta.url));
export const FILES = readdirSync(DIR).filter((f) => f.endsWith(".json"));
/** The boards this run routes: every one, but on a fast run. */
export const ROUTED = sampled(FILES, 12);

/** A stable fingerprint of the electrical partition — every point, and which
    net it landed in. Two documents with the same one are the same circuit. */
const netSignature = (doc) =>
  [...buildNetlist(doc).netOfPoint.entries()]
    .map(([point, net]) => `${point}=${net}`)
    .sort()
    .join("|");

/**
 * Every desktop a shipped example puts on the desk — `{label, doc}` — read the
 * way the app reads it (`exampleDesktops`). A hand-built example is several
 * desktops (`{ref, title, desktops}`), and read as one `doc` it was an EMPTY
 * desk: eleven of them "routed" without a wire for as long as they existed
 * (2026-10-11). So an example with no desktop, or one without a board, fails.
 * @param {string} file
 */
export function desktopsOf(file) {
  const payload = JSON.parse(readFileSync(`${DIR}${file}`, "utf8"));
  const ref = file.replace(/\.json$/, "");
  const desktops = exampleDesktops(ref, payload).map(({ name, doc }) => ({
    label: `${file} · ${name}`,
    doc: new DeskDoc(doc),
  }));
  assert.ok(desktops.length > 0, `${file}: no desktop read`);
  for (const { label, doc } of desktops) {
    assert.ok(doc.boards.length > 0, `${label}: an empty desk`);
  }
  return desktops;
}

/** Everything the router DECIDED — the paths and, since the router may now also
    move an end, the addresses it moved them to. Determinism has to cover both:
    a swap that came out differently run to run would be a document that differs
    while every drawn line matched. */
const shapeOf = (result) =>
  [
    ...[...result.routes.entries()]
      .map(
        ([id, r]) => `${id}:${r.points.map((p) => `${p.x},${p.y}`).join(";")}`,
      ) // prettier-ignore
      .sort(),
    ...[...result.reseats, ...result.swaps]
      .map((m) => `${m.wireId}.${m.end}:${m.from}>${m.to}`)
      .sort(),
  ].join("|");

/**
 * A route is orthogonal, with ONE sanctioned exception at each end.
 *
 * Runs sharing a lane are fanned off it so each wire is its own line, but a wire
 * still terminates EXACTLY on its hole — so the first and last segments pick up
 * the short angled lead-in a real lead has leaving its hole. Everything between
 * two corners is strictly axis-aligned, and the skew is bounded by how far a run
 * may be nudged, so a "lead-in" can never quietly become a diagonal route.
 */
function assertRunShape(route, id) {
  const pts = [route.ends[0], ...route.points, route.ends[1]];
  for (let i = 1; i < pts.length; i += 1) {
    const dx = Math.abs(pts[i - 1].x - pts[i].x);
    const dy = Math.abs(pts[i - 1].y - pts[i].y);
    if (dx < 1e-9 || dy < 1e-9) continue; // axis-aligned
    assert.ok(
      i === 1 || i === pts.length - 1,
      `${id}: a diagonal segment in the middle of the run`,
    );
    assert.ok(
      Math.min(dx, dy) <= ROUTE_CONFIG.laneOffsetMax + 1e-9,
      `${id}: the lead-in skews by ${Math.min(dx, dy)}`,
    );
  }
}

/** How many routing shards there are (autoroute-corpus-1…N.test.js). */
export const SHARDS = 4;

/** What routing an example costs, roughly: the square of each desktop's
    wire count (the router's work grows faster than its wires — the CPUs'
    computers, ~85 wires, take half a minute; a 25-wire bench a second). */
function routingCost(file) {
  const payload = JSON.parse(readFileSync(`${DIR}${file}`, "utf8"));
  const ref = file.replace(/\.json$/, "");
  return exampleDesktops(ref, payload).reduce(
    (sum, { doc }) => sum + (doc.wires?.length ?? 0) ** 2,
    0,
  );
}

/** The deal, made once: biggest cost first, each to the shard with the least
    so far (ties to the lower shard, then by name) — so no shard is one
    example's long pole while another idles. Deterministic. */
let deal = null;
function dealShards() {
  if (deal) return deal;
  const costs = new Map(FILES.map((f) => [f, routingCost(f)]));
  const order = [...FILES].sort((a, b) => costs.get(b) - costs.get(a) || (a < b ? -1 : 1)); // prettier-ignore
  const load = Array(SHARDS).fill(0);
  deal = Array.from({ length: SHARDS }, () => []);
  for (const file of order) {
    const k = load.indexOf(Math.min(...load));
    deal[k].push(file);
    load[k] += costs.get(file);
  }
  return deal;
}

/**
 * Shard `k`'s examples (1-based), dealt by routing cost (`dealShards`).
 * @param {number} k
 */
export function shardFiles(k) {
  return [...dealShards()[k - 1]].sort();
}

/** One example — each of its desktops — routed, and held to every rule above. */
export function routesLegally(file) {
  for (const { label, doc } of desktopsOf(file)) {
    try {
      routeOne(doc);
    } catch (err) {
      err.message = `${label}: ${err.message}`;
      throw err;
    }
  }
}

/** One desktop, routed and held to the rules. */
function routeOne(doc) {
  const before = netSignature(doc.toJSON());
  const result = routeDesk(doc.toJSON(), {});

  for (const skip of result.skipped) {
    assert.equal(skip.reason, SKIP_BUS_MEMBER, `${skip.wireId}: ${skip.reason}`); // prettier-ignore
  }

  for (const [id, route] of result.routes) {
    assert.ok(
      route.points.length <= MAX_WIRE_POINTS,
      `${id}: ${route.points.length} waypoints`,
    );
    for (const n of route.nodes) {
      assert.notEqual(
        result.space.nodeKind[n],
        OUTSIDE,
        `${id} left the legal region`,
      );
    }
    // Every rung of the escalation ladder past the first is a compromise, and
    // on a demo bench there should be no need for one.
    assert.equal(route.via, "direct", `${id} needed ${route.via}`);
    assert.equal(route.cost.overPart, 0, `${id} ran over a part`);
    assertRunShape(route, id);
  }

  const applied = doc.applyRoutes(routePlan(result));
  assert.equal(applied, result.routes.size);
  assert.equal(netSignature(doc.toJSON()), before, "the circuit is untouched");

  // The router may MOVE an end — a power lead along its rail, a signal wire
  // within its own tie-point strip — so "the route ends on the wire's hole"
  // has to be asked of the document as it now stands. Both are same-node
  // moves, which is why the netlist above did not notice; this is the other
  // half, that the drawing and the addresses agree about where the wire is.
  const after = doc.toJSON();
  // Occupied holes as GRID NODES, resolved exactly. Going the other way — a
  // route node looked up with `addressAtWorld` — answers with whatever hole is
  // within the hit radius, and the lanes are a third of a pitch apart, so a
  // run passing tidily BESIDE a lead reads as running through it.
  const occupied = new Map();
  for (const address of buildOccupancy(after).keys()) {
    const p = addressWorld(after.boards, after.components, address);
    if (p) occupied.set(result.space.nodeAt(p.x, p.y), address);
  }
  for (const [id, route] of result.routes) {
    const wire = after.wires.find((w) => w.id === id);
    for (const [end, at] of [
      [wire.from, route.ends[0]],
      [wire.to, route.ends[1]],
    ]) {
      const p = addressWorld(after.boards, after.components, end);
      assert.ok(
        Math.abs(p.x - at.x) < 1e-9 && Math.abs(p.y - at.y) < 1e-9,
        `${id}: the route does not start where the wire does (${end})`,
      );
    }
    // And no route may run THROUGH a tie point something is standing in —
    // asked of the holes as the moves left them, not as they were found.
    const ends = new Set([route.nodes[0], route.nodes[route.nodes.length - 1]]); // prettier-ignore
    for (const n of route.nodes) {
      if (ends.has(n)) continue;
      assert.ok(
        !occupied.has(n),
        `${id} ran through ${occupied.get(n)}, which has a lead in it`,
      );
    }
  }

  // A route only counts if it survives being written to a file and read back:
  // normalizeDocument re-coerces every waypoint on load.
  const reloaded = new DeskDoc(doc.toJSON());
  assert.equal(netSignature(reloaded.toJSON()), before);
  for (const wire of reloaded.wires) {
    assert.deepEqual(
      wire.points ?? [],
      doc.getWire(wire.id).points ?? [],
      `${wire.id}: waypoints are stable across a save/load`,
    );
  }
}

/** The sweep: every eighth board routed three times (twice as it is, once
    with its wires reversed), and the quality numbers read off the first. */
export function sweep() {
  // The property negotiated congestion exists to give: no wire's outcome may
  // depend on where it happened to sit in the document. The quality numbers ride
  // along on the same sweep rather than paying for a corpus pass of their own;
  // they are deliberately loose, here to catch a regression that makes the
  // router obviously worse rather than to pin the current tuning.
  let wires = 0;
  let bends = 0;
  let overlap = 0;
  let routed = 0;
  // Every eighth board, not all of them: this sweep routes each one three times
  // and the whole corpus at that rate is more wall-clock than a unit suite
  // should spend. The per-file tests above still cover every board once. A
  // fast run sweeps two, so it asks a smaller sample below.
  const boards = FAST
    ? [...sampled(FILES, 48)]
    : FILES.filter((_, i) => i % 8 === 0);
  for (const { label: file, doc } of boards.flatMap(desktopsOf)) {
    const json = doc.toJSON();
    const first = routeDesk(json, {});
    assert.equal(shapeOf(routeDesk(json, {})), shapeOf(first), `${file} twice`);
    const permuted = { ...json, wires: [...json.wires].reverse() };
    assert.equal(
      shapeOf(routeDesk(permuted, {})),
      shapeOf(first),
      `${file} reversed`,
    );
    for (const [, route] of first.routes) {
      wires += 1;
      bends += route.bends;
    }
    overlap += first.diagnostics.overlapUnits;
    routed += first.diagnostics.routedUnits;
  }
  assert.ok(wires > (FAST ? 20 : 100), `${wires} wires is a real sample`);
  assert.ok(
    bends / wires < 2.5,
    `${(bends / wires).toFixed(2)} bends per wire`,
  );
  assert.ok(
    overlap / routed < 0.02,
    `${((100 * overlap) / routed).toFixed(2)}% of run is doubled up`,
  );
}
