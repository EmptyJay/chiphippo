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

// speaker-audio.js — the speakers, heard. Every `chiphippo:sim-state` carries
// what each speaker on the desk is playing (Spice Lite's `tones`, spice/
// speakers.js: its pitch in the circuit's time, and the power in its coil);
// this plays each as a square wave through the Web Audio API, at that pitch
// times the run's speed — a quarter-speed run sounds two octaves down, as it
// blinks four times as slowly — and as loud as catalog/speaker.js
// `speakerLoudness` says. It renders from the broadcast alone, never asking
// the engine, as every other view does.
//
// The audio context is made the first time there is something to hear (a
// Run is a click, so the browser lets it start) and suspended whenever
// nothing plays. A tone that goes missing is held for HOLD_MS before it
// fades — a schedule measured afresh (spice/engine.js `clearMarks`) can leave
// a frame without one — and every change of pitch or loudness glides over a
// few milliseconds, so nothing clicks.

import { speakerLoudness } from "../catalog/speaker.js";

/** The pitches a speaker can be heard at, Hz (wall time); outside them it
    is silent. */
export const AUDIBLE_HZ = Object.freeze({ min: 20, max: 20e3 });

/** The loudest a speaker plays, as a gain: a full-scale square wave is
    harsh, and several at once add. */
export const MASTER_GAIN = 0.2;

/** How long a tone that went missing is held before it fades, ms. */
export const HOLD_MS = 150;

/** How fast a pitch or a loudness glides to a new one, seconds (a time
    constant). */
const GLIDE_S = 0.005;

/** How long a fade takes before its oscillator stops, seconds. */
const FADE_S = 0.05;

/**
 * What each speaker should sound like: id → `{hz, gain}` — the pitch in wall
 * time (its tone's × the run's `speed`) and its gain — for every one audible.
 * @param {Map<string, {hz: number, watts: number, volume: number}>|null} tones
 * @param {number} speed
 * @returns {Map<string, {hz: number, gain: number}>}
 */
export function speakerSounds(tones, speed = 1) {
  const out = new Map();
  for (const [id, tone] of tones ?? []) {
    const hz = tone.hz * speed;
    const gain = speakerLoudness(tone.watts, tone.volume) * MASTER_GAIN;
    if (!(hz >= AUDIBLE_HZ.min && hz <= AUDIBLE_HZ.max) || !(gain > 0)) continue; // prettier-ignore
    out.set(id, { hz, gain });
  }
  return out;
}

/** A new Web Audio context, or null where there is none (a test). */
function defaultContext() {
  const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  return Context ? new Context() : null;
}

export class SpeakerAudio {
  #makeContext;
  #context = null;
  #voices = new Map(); // id → {osc, gain, hold}
  #timers;

  /**
   * @param {object} [opts]
   * @param {() => AudioContext|null} [opts.makeContext]
   * @param {{setTimeout: Function, clearTimeout: Function}} [opts.timers]
   */
  constructor({ makeContext = defaultContext, timers = globalThis } = {}) {
    this.#makeContext = makeContext;
    this.#timers = timers;
  }

  /** The speakers sounding now (their ids). */
  get playing() {
    return [...this.#voices.keys()];
  }

  /**
   * One sim-state: play what its `tones` say, at the run's `speed`. Anything
   * but a running board is silence.
   * @param {{running?: boolean, tones?: Map}} detail
   * @param {number} [speed]
   */
  update(detail, speed = 1) {
    if (!detail?.running) {
      this.silence();
      return;
    }
    const sounds = speakerSounds(detail.tones, speed);
    for (const [id, sound] of sounds) this.#sound(id, sound);
    for (const [id, voice] of this.#voices) {
      if (sounds.has(id) || voice.hold != null) continue;
      voice.hold = this.#timers.setTimeout(() => this.#release(id), HOLD_MS);
    }
  }

  /** Every speaker quiet at once (a Stop, a pause). */
  silence() {
    for (const id of [...this.#voices.keys()]) this.#release(id);
  }

  /** Start or retune one speaker's voice. */
  #sound(id, { hz, gain }) {
    let voice = this.#voices.get(id);
    if (voice?.hold != null) {
      this.#timers.clearTimeout(voice.hold);
      voice.hold = null;
    }
    if (!voice) {
      this.#context ??= this.#makeContext();
      const ctx = this.#context;
      if (!ctx) return;
      if (ctx.state === "suspended") void ctx.resume?.();
      const osc = ctx.createOscillator();
      osc.type = "square";
      osc.frequency.value = hz;
      const amp = ctx.createGain();
      amp.gain.value = 0;
      osc.connect(amp);
      amp.connect(ctx.destination);
      osc.start();
      voice = { osc, gain: amp, hold: null };
      this.#voices.set(id, voice);
    }
    const now = this.#context.currentTime;
    voice.osc.frequency.setTargetAtTime(hz, now, GLIDE_S);
    voice.gain.gain.setTargetAtTime(gain, now, GLIDE_S);
  }

  /** Fade one speaker's voice out and let it go. */
  #release(id) {
    const voice = this.#voices.get(id);
    if (!voice) return;
    if (voice.hold != null) this.#timers.clearTimeout(voice.hold);
    this.#voices.delete(id);
    const ctx = this.#context;
    const now = ctx.currentTime;
    voice.gain.gain.setTargetAtTime(0, now, FADE_S / 4);
    voice.osc.stop(now + FADE_S);
    voice.osc.onended = () => {
      voice.osc.disconnect();
      voice.gain.disconnect();
      if (!this.#voices.size && ctx.state === "running") void ctx.suspend?.();
    };
  }
}
