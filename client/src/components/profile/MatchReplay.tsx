import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { MatchDetail } from '../../lib/account';
import { cx } from '../../lib/cx';
import { PauseIcon, PlayIcon, StepIcon } from '../icons';
import { Piece } from '../Pieces';

/**
 * Step-through replay of a stored game. Moves alternate from X (X always
 * moves first), so the list of cell indices is all that's stored.
 */
export function MatchReplay({ match }: { match: MatchDetail }) {
  const total = match.moves.length;
  const [step, setStep] = useState(total);
  const [playing, setPlaying] = useState(false);
  const n = match.boardSize;

  useEffect(() => {
    if (!playing) return;
    if (step >= total) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => setStep((s) => Math.min(total, s + 1)), total > 120 ? 140 : 320);
    return () => clearTimeout(t);
  }, [playing, step, total]);

  const board = useMemo(() => {
    const cells = new Map<number, { mark: 'X' | 'O'; order: number }>();
    for (let i = 0; i < step; i++) cells.set(match.moves[i], { mark: i % 2 === 0 ? 'X' : 'O', order: i });
    return cells;
  }, [match.moves, step]);
  const win = step === total && match.winLine ? new Set(match.winLine) : null;
  const last = step > 0 ? match.moves[step - 1] : null;

  const play = () => {
    if (step >= total) setStep(0);
    setPlaying((p) => !p || step >= total);
  };

  return (
    <div>
      <div className="mx-auto w-full max-w-[420px] rounded-2xl bg-white p-2 shadow-soft ring-1 ring-slate-200/70">
        <div
          className="grid overflow-hidden rounded-xl border border-slate-200 bg-slate-200/90"
          style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`, gap: n > 20 ? 0.5 : 1 }}
          role="img"
          aria-label={`Bàn cờ sau nước thứ ${step} trên ${total}`}
        >
          {Array.from({ length: n * n }, (_, i) => {
            const cell = board.get(i);
            return (
              <div
                key={i}
                className={cx(
                  'grid aspect-square place-items-center',
                  win?.has(i) ? 'bg-emerald-100' : 'bg-paper',
                  last === i && !win && 'ring-2 ring-amber-300 ring-inset',
                )}
              >
                {cell && <Piece mark={cell.mark} className="h-[86%] w-[86%]" strokeWidth={n > 20 ? 7 : 6} />}
              </div>
            );
          })}
        </div>
      </div>

      <div className="mx-auto mt-3 flex max-w-[420px] items-center gap-2">
        <ReplayButton label="Nước trước" onClick={() => (setPlaying(false), setStep((s) => Math.max(0, s - 1)))} disabled={step === 0}>
          <StepIcon back size={16} />
        </ReplayButton>
        <ReplayButton label={playing ? 'Tạm dừng' : 'Phát lại'} onClick={play} primary disabled={total === 0}>
          {playing ? <PauseIcon size={16} /> : <PlayIcon size={16} />}
        </ReplayButton>
        <ReplayButton label="Nước sau" onClick={() => (setPlaying(false), setStep((s) => Math.min(total, s + 1)))} disabled={step === total}>
          <StepIcon size={16} />
        </ReplayButton>
        <input
          type="range"
          min={0}
          max={total}
          value={step}
          onChange={(e) => {
            setPlaying(false);
            setStep(Number(e.target.value));
          }}
          aria-label="Chọn nước đi"
          className="h-2 min-w-0 flex-1 cursor-pointer accent-brand-500"
        />
        <span className="tabular w-16 text-right text-xs font-bold text-slate-500">
          {step}/{total}
        </span>
      </div>
      {total === 0 && <p className="mt-2 text-center text-xs font-semibold text-slate-400">Ván kết thúc trước khi có nước đi nào.</p>}
    </div>
  );
}

function ReplayButton({ label, onClick, disabled, primary, children }: { label: string; onClick: () => void; disabled?: boolean; primary?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cx(
        'grid h-9 w-9 shrink-0 place-items-center rounded-xl transition-all active:scale-95 disabled:opacity-40',
        primary ? 'bg-gradient-to-b from-brand-400 to-brand-600 text-white shadow-[0_6px_14px_-6px_rgb(37_99_235/0.6)]' : 'bg-white text-slate-500 ring-1 ring-slate-200 hover:text-brand-600',
      )}
    >
      {children}
    </button>
  );
}
