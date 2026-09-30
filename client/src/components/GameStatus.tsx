import { cx } from '../lib/cx';
import type { Mark } from '../lib/protocol';
import { EyeIcon, TrophyIcon, WifiOffIcon } from './icons';
import { Piece } from './Pieces';
import { LoadingDots } from './ui';

export type StatusTone = 'neutral' | 'turn' | 'waiting' | 'success' | 'warning';

interface GameStatusProps {
  tone: StatusTone;
  text: string;
  mark?: Mark | null;
  spectating?: boolean;
  className?: string;
}

const toneClass: Record<StatusTone, string> = {
  neutral: 'bg-white text-slate-600 ring-slate-200',
  turn: 'bg-brand-500 text-white ring-brand-500 shadow-[0_8px_20px_-8px_rgb(37_99_235/0.6)]',
  waiting: 'bg-white text-slate-600 ring-slate-200',
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  warning: 'bg-orange-50 text-orange-700 ring-orange-200',
};

export function GameStatus({ tone, text, mark, spectating, className }: GameStatusProps) {
  return (
    <div className={cx('flex items-center justify-center gap-2', className)}>
      <div
        key={text}
        role="status"
        aria-live="polite"
        className={cx(
          'animate-fade-up inline-flex max-w-full items-center gap-2 rounded-full px-4 py-1.5 font-display text-sm font-semibold ring-1 sm:text-[15px]',
          toneClass[tone],
        )}
      >
        {tone === 'success' && <TrophyIcon size={16} className="shrink-0" />}
        {tone === 'warning' && <WifiOffIcon size={16} className="shrink-0" />}
        {mark && tone !== 'success' && (
          <span className={cx('grid h-5 w-5 shrink-0 place-items-center rounded-full', tone === 'turn' ? 'bg-white' : 'bg-slate-50')}>
            <Piece mark={mark} className="h-4 w-4" strokeWidth={6} />
          </span>
        )}
        <span className="truncate">{text}</span>
        {tone === 'waiting' && <LoadingDots className="text-slate-400" />}
      </div>
      {spectating && (
        <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2.5 py-1 text-xs font-bold text-violet-600 ring-1 ring-violet-200">
          <EyeIcon size={14} /> Đang xem
        </span>
      )}
    </div>
  );
}
