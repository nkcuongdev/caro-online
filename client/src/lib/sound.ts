/**
 * Tiny synthesized sound effects (Web Audio), so there are no audio assets to
 * load. Everything is short and quiet by design.
 */
const KEY = 'caro:sound';
let enabled = (() => {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
})();
let ctx: AudioContext | null = null;
const listeners = new Set<(on: boolean) => void>();

function audio(): AudioContext | null {
  if (!enabled || typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx ??= new Ctor();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function tone(freq: number, { at = 0, dur = 0.12, type = 'sine' as OscillatorType, gain = 0.08, to }: { at?: number; dur?: number; type?: OscillatorType; gain?: number; to?: number } = {}) {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime + at;
  const osc = ac.createOscillator();
  const vol = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
  vol.gain.setValueAtTime(0.0001, t);
  vol.gain.exponentialRampToValueAtTime(gain, t + 0.012);
  vol.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(vol).connect(ac.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

export const sfx = {
  place(mine: boolean) {
    tone(mine ? 520 : 440, { dur: 0.09, type: 'triangle', gain: 0.1, to: mine ? 780 : 620 });
  },
  tick(urgent: boolean) {
    tone(urgent ? 980 : 760, { dur: 0.05, type: 'square', gain: 0.025 });
  },
  countdown(final: boolean) {
    tone(final ? 880 : 587, { dur: final ? 0.28 : 0.14, type: 'triangle', gain: 0.09 });
  },
  join() {
    tone(523, { dur: 0.1, type: 'triangle' });
    tone(784, { at: 0.09, dur: 0.14, type: 'triangle' });
  },
  win() {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, { at: i * 0.1, dur: 0.22, type: 'triangle', gain: 0.09 }));
  },
  lose() {
    [392, 330, 262].forEach((f, i) => tone(f, { at: i * 0.14, dur: 0.24, type: 'sine', gain: 0.08 }));
  },
  error() {
    tone(220, { dur: 0.12, type: 'sawtooth', gain: 0.03 });
  },
  /** Tournament: your match is ready, confirm now. */
  readyCheck() {
    [659, 880, 659, 880].forEach((f, i) => tone(f, { at: i * 0.12, dur: 0.12, type: 'triangle', gain: 0.09 }));
  },
  /** Tournament: a player moves on to the next round. */
  advance() {
    [587, 740, 988].forEach((f, i) => tone(f, { at: i * 0.07, dur: 0.14, type: 'triangle', gain: 0.07 }));
  },
  /** Tournament: champion crowned. */
  fanfare() {
    [523, 523, 659, 784, 1047, 784, 1047].forEach((f, i) =>
      tone(f, { at: [0, 0.12, 0.24, 0.36, 0.52, 0.7, 0.82][i], dur: i === 6 ? 0.5 : 0.16, type: 'triangle', gain: 0.09 }),
    );
  },
  /** Achievement unlocked: a bright rising sparkle, grander for rarer ones. */
  achievement(grand: boolean) {
    const notes = grand ? [659, 831, 988, 1319, 1661] : [784, 988, 1319];
    notes.forEach((f, i) => tone(f, { at: i * 0.075, dur: i === notes.length - 1 ? 0.4 : 0.14, type: 'triangle', gain: 0.07 }));
    tone(2637, { at: notes.length * 0.075, dur: 0.25, type: 'sine', gain: 0.025 });
  },
  /** Incoming chat message while the chat isn't on screen. */
  message() {
    tone(880, { dur: 0.07, type: 'sine', gain: 0.05 });
    tone(1175, { at: 0.07, dur: 0.1, type: 'sine', gain: 0.045 });
  },
};

export const isSoundOn = () => enabled;

export function setSoundOn(on: boolean) {
  enabled = on;
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    /* storage unavailable */
  }
  listeners.forEach((fn) => fn(on));
}

export function onSoundChange(fn: (on: boolean) => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/** Browsers only allow audio after a user gesture; warm the context on the first one. */
export function unlockAudioOnGesture() {
  const unlock = () => {
    audio();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}
