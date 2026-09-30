import type { ReactNode } from 'react';
import { CARO_STICKERS } from '../../lib/stickers';

/**
 * Stickers drawn for this game: the X and O pieces as little characters with
 * a speech label. Pure SVG + CSS animation, so they cost no downloads.
 */

const INK = '#1e293b';
const CORAL = '#f96b4f';
const BLUE = '#3b82f6';

type Face = 'happy' | 'grin' | 'star' | 'shock' | 'sad' | 'wink' | 'think' | 'smug' | 'fierce';
type Anim = 'bounce' | 'pop' | 'shake' | 'wiggle' | 'float' | 'droop';

interface Design {
  piece: 'X' | 'O' | 'XO';
  face: Face;
  anim: Anim;
  extra?: 'sweat' | 'crown' | 'dots' | 'sparkle' | 'tear';
}

const DESIGNS: Record<string, Design> = {
  gg: { piece: 'O', face: 'grin', anim: 'bounce' },
  nice: { piece: 'X', face: 'star', anim: 'pop', extra: 'sparkle' },
  hurry: { piece: 'O', face: 'shock', anim: 'shake', extra: 'sweat' },
  oops: { piece: 'X', face: 'shock', anim: 'shake', extra: 'sweat' },
  rematch: { piece: 'XO', face: 'happy', anim: 'wiggle' },
  thinking: { piece: 'O', face: 'think', anim: 'float', extra: 'dots' },
  easy: { piece: 'X', face: 'smug', anim: 'bounce', extra: 'crown' },
  lucky: { piece: 'O', face: 'wink', anim: 'wiggle', extra: 'sparkle' },
  block: { piece: 'X', face: 'fierce', anim: 'pop' },
  sad: { piece: 'O', face: 'sad', anim: 'droop', extra: 'tear' },
};

function FaceArt({ face, x, y }: { face: Face; x: number; y: number }) {
  const t = `translate(${x} ${y})`;
  const line = { stroke: INK, strokeWidth: 2.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  const eyes = (
    <>
      <circle cx={-6} cy={-3} r={2.6} fill={INK} />
      <circle cx={6} cy={-3} r={2.6} fill={INK} />
    </>
  );
  const cheeks = (
    <>
      <circle cx={-10} cy={4} r={2.4} fill="#fda4af" opacity={0.8} />
      <circle cx={10} cy={4} r={2.4} fill="#fda4af" opacity={0.8} />
    </>
  );
  let body: ReactNode;
  switch (face) {
    case 'grin':
      body = (
        <>
          <path d="M-9 -2 q3 -4 6 0 M3 -2 q3 -4 6 0" {...line} />
          <path d="M-6 3 h12 q0 7 -6 7 q-6 0 -6 -7 Z" fill={INK} />
          <path d="M-3 8 q3 -2.5 6 0" fill="#fb7185" />
          {cheeks}
        </>
      );
      break;
    case 'star':
      body = (
        <>
          {[-6, 6].map((cx) => (
            <path key={cx} transform={`translate(${cx} -3)`} d="M0 -4 L1.2 -1.2 L4 -1 L1.8 0.9 L2.5 3.8 L0 2.2 L-2.5 3.8 L-1.8 0.9 L-4 -1 L-1.2 -1.2 Z" fill="#f59e0b" />
          ))}
          <path d="M-6 3 h12 q0 7 -6 7 q-6 0 -6 -7 Z" fill={INK} />
          {cheeks}
        </>
      );
      break;
    case 'shock':
      body = (
        <>
          <circle cx={-6} cy={-3} r={3.6} fill="#fff" stroke={INK} strokeWidth={1.8} />
          <circle cx={6} cy={-3} r={3.6} fill="#fff" stroke={INK} strokeWidth={1.8} />
          <circle cx={-6} cy={-3} r={1.5} fill={INK} />
          <circle cx={6} cy={-3} r={1.5} fill={INK} />
          <ellipse cx={0} cy={7} rx={3} ry={3.8} fill={INK} />
        </>
      );
      break;
    case 'sad':
      body = (
        <>
          <path d="M-9 -6 l5 2 M9 -6 l-5 2" {...line} strokeWidth={2} />
          {eyes}
          <path d="M-5 9 q5 -5 10 0" {...line} />
        </>
      );
      break;
    case 'wink':
      body = (
        <>
          <circle cx={-6} cy={-3} r={2.6} fill={INK} />
          <path d="M3 -3 q3 -3.5 6 0" {...line} />
          <path d="M-6 3 q6 7 12 0" {...line} />
          <path d="M1 6.5 q2 4 4 0" fill="#fb7185" />
          {cheeks}
        </>
      );
      break;
    case 'think':
      body = (
        <>
          <circle cx={-5} cy={-5} r={2.4} fill={INK} />
          <circle cx={7} cy={-5} r={2.4} fill={INK} />
          <path d="M-9 -10 l6 -1.5" {...line} strokeWidth={2} />
          <path d="M-3 6 h7" {...line} />
        </>
      );
      break;
    case 'smug':
      body = (
        <>
          <path d="M-9 -3 h6 M3 -3 h6" {...line} />
          <path d="M-8.5 -3 q2.5 3 5 0 M3.5 -3 q2.5 3 5 0" fill={INK} />
          <path d="M-5 5 q6 4 10 -2" {...line} />
        </>
      );
      break;
    case 'fierce':
      body = (
        <>
          <path d="M-10 -8 l7 3 M10 -8 l-7 3" {...line} />
          {eyes}
          <path d="M-5 7 h10" {...line} strokeWidth={3} />
        </>
      );
      break;
    default:
      body = (
        <>
          {eyes}
          <path d="M-6 3 q6 7 12 0" {...line} />
          {cheeks}
        </>
      );
  }
  return <g transform={t}>{body}</g>;
}

function XPiece({ x, y, s = 1, face }: { x: number; y: number; s?: number; face: Face }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <path d="M-28 -28 L28 28 M28 -28 L-28 28" stroke={CORAL} strokeWidth={20} strokeLinecap="round" />
      <path d="M-26 -26 L-14 -14" stroke="#ffcbbd" strokeWidth={6} strokeLinecap="round" />
      <circle r={17} fill="#fff" stroke="#ffe6df" strokeWidth={2} />
      <FaceArt face={face} x={0} y={0} />
    </g>
  );
}

function OPiece({ x, y, s = 1, face }: { x: number; y: number; s?: number; face: Face }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <circle r={30} fill="#fff" stroke={BLUE} strokeWidth={15} />
      <path d="M-24 -14 A28 28 0 0 1 -8 -27" stroke="#bfdbfe" strokeWidth={5} strokeLinecap="round" fill="none" />
      <FaceArt face={face} x={0} y={0} />
    </g>
  );
}

function Extra({ kind }: { kind: NonNullable<Design['extra']> }) {
  switch (kind) {
    case 'sweat':
      return <path d="M92 18 q6 9 0 12 q-6 -3 0 -12 Z" fill="#7dd3fc" stroke="#38bdf8" strokeWidth={1.5} />;
    case 'tear':
      return <path d="M50 58 q5 8 0 11 q-5 -3 0 -11 Z" fill="#7dd3fc" />;
    case 'crown':
      return <path d="M44 14 l5 -10 l6 7 l5 -9 l5 9 l6 -7 l5 10 Z" fill="#fbbf24" stroke="#f59e0b" strokeWidth={2} strokeLinejoin="round" />;
    case 'dots':
      return (
        <g fill="#94a3b8">
          <circle cx={92} cy={16} r={3} />
          <circle cx={101} cy={10} r={4} />
          <circle cx={111} cy={3} r={5} />
        </g>
      );
    case 'sparkle':
      return (
        <g fill="#fbbf24">
          <path d="M98 10 l2.5 6 l6 2.5 l-6 2.5 l-2.5 6 l-2.5 -6 l-6 -2.5 l6 -2.5 Z" />
          <path d="M18 72 l1.5 3.5 l3.5 1.5 l-3.5 1.5 l-1.5 3.5 l-1.5 -3.5 l-3.5 -1.5 l3.5 -1.5 Z" />
        </g>
      );
  }
}

export function CaroSticker({ slug, className }: { slug: string; className?: string }) {
  const d = DESIGNS[slug];
  const label = CARO_STICKERS[slug];
  if (!d || !label) return null;
  const color = d.piece === 'X' ? '#e2523a' : '#2563eb';
  return (
    <svg viewBox="0 0 120 120" className={className} role="img" aria-label={label}>
      <g className={`caro-sticker-${d.anim}`}>
        {d.piece === 'X' && <XPiece x={60} y={50} face={d.face} />}
        {d.piece === 'O' && <OPiece x={60} y={50} face={d.face} />}
        {d.piece === 'XO' && (
          <>
            <XPiece x={36} y={52} s={0.62} face="grin" />
            <OPiece x={85} y={48} s={0.62} face={d.face} />
          </>
        )}
        {d.extra && <Extra kind={d.extra} />}
      </g>
      <rect x={10} y={90} width={100} height={25} rx={12.5} fill="#fff" stroke={color} strokeWidth={3} />
      <text x={60} y={108} textAnchor="middle" fontFamily="'Baloo 2', ui-rounded, sans-serif" fontWeight={800} fontSize={label.length > 10 ? 13 : 15} fill={color}>
        {label}
      </text>
    </svg>
  );
}
