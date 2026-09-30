import type { ReactionsApi } from '../../hooks/useReactions';
import { cx } from '../../lib/cx';
import { SmileIcon } from '../icons';
import { ReactionPicker } from './ReactionPicker';

/**
 * Desktop card: every reaction one click away. It takes whatever height is
 * left in the column and scrolls inside, so the player card above never gets
 * pushed out of view on short screens.
 */
export function ReactionPanel({ reactions, canTalk, className }: { reactions: ReactionsApi; canTalk: boolean; className?: string }) {
  return (
    <section aria-label="Biểu cảm" className={cx('flex min-h-0 flex-col rounded-3xl bg-white/90 p-3.5 shadow-soft ring-1 ring-slate-200/70', className)}>
      <div className="mb-2 flex shrink-0 items-center gap-2">
        <SmileIcon size={16} className="text-brand-500" />
        <h2 className="font-display text-[15px] font-bold text-slate-700">Biểu cảm</h2>
        <span className="ml-auto text-[11px] font-semibold text-slate-400">{reactions.coolingDown ? 'Chờ chút…' : 'Bấm để gửi'}</span>
      </div>
      <div className="board-scroll -mx-1 min-h-0 flex-1 overflow-y-auto px-1">
        <ReactionPicker onPick={reactions.send} coolingDown={reactions.coolingDown} disabled={!canTalk} />
      </div>
    </section>
  );
}
