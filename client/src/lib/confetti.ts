import confetti from 'canvas-confetti';

const COLORS = ['#3b82f6', '#60a5fa', '#ff8a70', '#34d399', '#a78bfa', '#fbbf24'];

/** A light celebratory burst: two side cannons, then a small shower. */
export function celebrate() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const base = { colors: COLORS, ticks: 180, gravity: 1.1, scalar: 0.9, disableForReducedMotion: true, zIndex: 40 };
  confetti({ ...base, particleCount: 60, angle: 60, spread: 60, origin: { x: 0, y: 0.75 } });
  confetti({ ...base, particleCount: 60, angle: 120, spread: 60, origin: { x: 1, y: 0.75 } });
  window.setTimeout(() => confetti({ ...base, particleCount: 50, spread: 100, startVelocity: 25, origin: { x: 0.5, y: 0.3 } }), 250);
}
