# RC & LC examples — passives you can see (2026-10-11, no feature number)

Two hand-built examples that make resistors, capacitors and inductors visibly do
what their values say, under **Spice Lite** (the logic engine runs a capacitor as
nothing and a coil as a wire, so it shows none of this). Each opens from its part's
Pin Assignment window; `tests/spice-rlc-examples.test.js` holds every figure below to
its closed form, computed from the parts' own values on the desk.

| Example | Opens from | Project |
|---|---|---|
| Fade, Timer | `cap-electrolytic` | `demos/rc.chiphippo` |
| Ringing | `inductor` | `demos/lc.chiphippo` |

## 1. Fade — capacitance as time

+5 V → push button → 100 Ω → two 1N4148s → C1 = 1000 µF / C2 = 220 µF → each through
1 kΩ + red LED → GND.

- Held: both capacitors charge to 3.91 V (5 V less the diode and the 100 Ω's drop
  under the LEDs' own draw).
- Released: each empties through 1 kΩ and its LED, τ = RC = 1.0 s / 0.22 s. The LED's
  forward voltage is not constant, so the decay is not a pure exponential — but both
  branches are identical apart from C, so the **ratio** of their dark times is C1/C2.

| | Predicted | Measured (engine) |
|---|---|---|
| Dark time ratio | 1000/220 = 4.545 | 4.545 (6.39 s / 1.41 s) |

## 2. Timer — τ = RC through a Schmitt input

Slide switch (GND ↔ +5 V) → 10 kΩ → 100 µF; the capacitor drives a CD40106B input
(no input current, so it does not load the RC: V+ 2.9 V, V− 1.9 V at 5 V); its output
sinks a green LED through 1 kΩ from +5 V. A yellow LED on the switch shows the input.

| | Formula | Predicted | Measured |
|---|---|---|---|
| V_C at t = τ | 5·(1 − e⁻¹) | 3.1606 V | 3.1606 V |
| LED on delay | τ·ln(5 / (5 − 2.9)) | 0.8675 s | 0.8675 s |
| LED off delay (from 4.966 V after 5τ) | τ·ln(V₀ / 1.9) | 0.9608 s | 0.9608 s |

## 3. Ringing — series RLC step response

1 kHz clock → CD4040B ÷1024 (Q10, 0.977 Hz) → 680 Ω → node A, with 2.2 kΩ from A to
each rail → 10 H coil (3-hole toroid, Lowest winding: 0.4·(10⁴)^0.91·0.6 = 1048 Ω) →
1 µF → GND.

- The divider exists for the analyzer: its voltage lane is fixed at 0 V to the highest
  supply, so A steps between 1.26 V and 3.74 V and the ring (0.18–4.82 V) fills the
  lane without clipping.
- The 1 kHz clock exists for the analyzer too: a ringing coil alone is redrawn at
  30 frames/s, which would alias a 49 Hz ring; the clock's edges are ~2000 ticks a
  second, ~40 analyzer columns a cycle.
- f₀ = 1/(2π√LC) = 50.3 Hz. R = winding + the drive's Thevenin (the divider with the
  CD4040B's ~440 Ω output resistance, read off Q10's sag) ≈ 1.6 kΩ, ζ = (R/2)·√(C/L)
  ≈ 0.25.

| | Formula | Predicted | Measured |
|---|---|---|---|
| Ring period | 2π / (ω₀√(1 − ζ²)) | 20.54 ms | 20.55 ms |
| First overshoot | exp(−πζ/√(1 − ζ²)) | 43.9 % | 43.7 % |

## Weaknesses

- **Spice Lite only.** Every desktop's label says to turn it on; with it off, the LEDs
  switch instantly and nothing rings. engine-parity exempts all three (`PASSIVE`).
- **The analyzer lane is small.** 26 px for 0–5 V, so even a full-lane ring is a modest
  wiggle — legible, but the probe and the Δ cursor are the instruments for the figures.
  A taller (or auto-ranging) voltage lane would be the real fix, in `scope-view.js`.
- **The ring depends on the 1 kHz clock** for its analyzer columns. Drop-in alternative
  if that is ever unwanted: 10 H with 10 µF (f₀ ≈ 16 Hz) rings with ζ ≈ 0.7 — only a
  5 % overshoot, but it survives a slower clock.
- **The analyzer's x-axis is ticks, not time**, so the Fade traces bunch where the LED
  wakes the engine often and stretch where it does not; the Δ-ms readout is true time.
- **LED brightness steps** at each halving of its current (the junction table's corners),
  so a fade looks stepped rather than smooth.
