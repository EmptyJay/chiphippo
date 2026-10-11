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

// part-body-box.js — a seated part's drawn body, for the auto-router.

import { partDef } from "../catalog/index.js";
import { chipBodyBox } from "./chip-view.js";
import { discreteBox } from "./discrete-view.js";

/**
 * A seated part's DRAWN body, local to its anchor hole — what the auto-router
 * has to route around, which is not the same thing as where its pins are. A
 * 7-segment digit's nine pins lie along ONE row while the block itself stands
 * seven pitch above them; sized from pins alone, a wire runs straight through
 * the middle of the display.
 *
 * It lives here because the geometry does: `chipBodyBox` and `discreteBox`
 * belong to the views, and `model/route-space.js` may not import from
 * `components/`. So the model takes this as an argument and the view side
 * answers — the desk's auto-route (DeskController) and `make demos`'
 * (scripts/demo-computers.mjs) alike, so a shipped route is the one the desk
 * would draw.
 *
 * Null means "size it from the pins instead", which is right for a DIP and
 * honest for an unknown ref. A part in the TWO-FREE-ENDS form is deliberately
 * null too: its leads can be on different strips at any angle, so there is no
 * anchored box to place — its pin extent is the only truthful answer.
 */
export function partBodyBox(comp) {
  try {
    const def = partDef(comp.ref);
    if (!def) return null;
    if (def.rotatable && comp.params?.rot === 90) return null;
    if (comp.kind === "chip") {
      return def.package ? chipBodyBox(def.package, comp.anchor) : null;
    }
    return discreteBox(comp.ref, comp.params?.rot, comp.params);
  } catch {
    return null; // an unknown ref sizes itself from its pins
  }
}
