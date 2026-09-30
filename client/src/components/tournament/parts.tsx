import { useId } from 'react';
import { useServerNow } from '../../lib/clock';
import { cx } from '../../lib/cx';
import type { PublicMatch, PublicParticipant } from '../../lib/protocol';
import { AvatarWithFrame } from '../AvatarWithFrame';
import { CheckIcon, EyeIcon, TimerIcon } from '../icons';

/** Gold cup with a star, drawn in SVG so it scales from a 20px chip to the champion screen. */
export function Trophy({ className }: { className?: string }) {
  const id = useId();
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={`${id}g`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fde68a" />
          <stop offset="0.5" stopColor="#fbbf24" />
          <stop offset="1" stopColor="#f59e0b" />
        </linearGradient>
        <linearGradient id={`${id}b`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#a78bfa" />
          <stop offset="1" stopColor="#7c3aed" />
        </linearGradient>
      </defs>
      <path d="M18 10h28v6h8a2 2 0 0 1 2 2v3c0 7-5 12-12 13a15 15 0 0 1-8 7v5h-8v-5a15 15 0 0 1-8-7C13 33 8 28 8 21v-3a2 2 0 0 1 2-2h8v-6Zm-5 11c0 3.6 2.3 6.4 5.8 7.6A22 22 0 0 1 18 22v-1h-5Zm38 0h-5v1c0 2.3-.3 4.5-.8 6.6 3.5-1.2 5.8-4 5.8-7.6Z" fill={`url(#${id}g)`} />
      <path d="M32 15.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8L32 15.5Z" fill="#fff" opacity="0.9" />
      <rect x="21" y="46" width="22" height="9" rx="3" fill={`url(#${id}b)`} />
      <rect x="25" y="49" width="14" height="3" rx="1.5" fill="#fff" opacity="0.55" />
      <path d="M22 12h4v14a9 9 0 0 1-3 6c-1.5-2-1-6-1-10V12Z" fill="#fff" opacity="0.28" />
    </svg>
  );
}

/** Small crown, for the host and the champion. */
export function Crown({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5L3 8Z" fill="#fbbf24" stroke="#d97706" strokeWidth="1.4" strokeLinejoin="round" />
      <circle cx="12" cy="15" r="1.6" fill="#fff" />
    </svg>
  );
}

export function LiveDot({ className }: { className?: string }) {
  return (
    <span className={cx('relative flex h-2 w-2', className)}>
      <span className="absolute inset-0 animate-ping-soft rounded-full bg-rose-400" />
      <span className="relative h-2 w-2 rounded-full bg-rose-500" />
    </span>
  );
}

/** Seconds left on a server deadline, re-rendered from the synced clock. */
export function useCountdown(deadline: number | null) {
  const now = useServerNow(250, deadline !== null);
  return deadline === null ? 0 : Math.max(0, Math.ceil((deadline - now) / 1000));
}

export function MatchStatusChip({ match, className }: { match: PublicMatch; className?: string }) {
  const secs = useCountdown(match.status === 'READY_CHECK' ? match.readyDeadline : null);
  const base = 'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-extrabold tracking-wide uppercase';
  if (match.status === 'LIVE') {
    return (
      <span className={cx(base, 'bg-rose-500 text-white shadow-[0_4px_10px_-4px_rgb(244_63_94/0.8)]', className)}>
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" /> Live
      </span>
    );
  }
  if (match.status === 'READY_CHECK') {
    return (
      <span className={cx(base, 'tabular bg-amber-100 text-amber-700 ring-1 ring-amber-200', className)}>
        <TimerIcon size={11} /> {secs}s
      </span>
    );
  }
  if (match.status === 'DONE') {
    return (
      <span className={cx(base, match.reason === 'bye' ? 'bg-slate-100 text-slate-400' : 'bg-emerald-50 text-emerald-600', className)}>
        {match.reason === 'bye' ? 'Miễn đấu' : (
          <>
            <CheckIcon size={11} /> Xong
          </>
        )}
      </span>
    );
  }
  return <span className={cx(base, 'bg-slate-100 text-slate-400', className)}>Chờ</span>;
}

export function SeedBadge({ seed, className }: { seed: number | null; className?: string }) {
  if (!seed) return null;
  return (
    <span className={cx('tabular inline-grid h-4 min-w-4 place-items-center rounded-md bg-slate-100 px-1 text-[10px] font-extrabold text-slate-400', className)}>
      {seed}
    </span>
  );
}

/** Avatar with an online dot, the building block of every player row. */
export function Face({ p, className, dot = true }: { p: PublicParticipant; className?: string; dot?: boolean }) {
  return (
    <span className="relative shrink-0">
      <AvatarWithFrame avatar={p.avatar} frameId={p.avatarFrame} seed={p.id} name={p.name} className={cx('rounded-xl bg-brand-50', p.left && 'opacity-50 grayscale', className)} animated={false} />
      {dot && (
        <span
          className={cx('absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-white', p.online ? 'bg-emerald-400' : 'bg-slate-300')}
          title={p.online ? 'Trực tuyến' : 'Ngoại tuyến'}
        />
      )}
    </span>
  );
}

export function SpectatorPill({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full bg-violet-50 px-2.5 py-1 text-xs font-bold text-violet-600 ring-1 ring-violet-200', className)}>
      <EyeIcon size={14} /> {count}
    </span>
  );
}
