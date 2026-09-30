import { cx } from '../../lib/cx';
import type { ChatMessage } from '../../lib/protocol';
import { AvatarImage } from '../Avatar';

/**
 * Live comments from the stands sliding in over the lower-left of the board,
 * for players during a game. Never takes clicks, so it can't block a move.
 */
export function CommentTicker({ items, className }: { items: ChatMessage[]; className?: string }) {
  if (!items.length) return null;
  return (
    <div
      className={cx('pointer-events-none absolute bottom-12 left-3 z-20 flex max-w-[min(75%,320px)] flex-col items-start gap-1.5', className)}
      aria-live="polite"
    >
      {items.map((m) => (
        <div
          key={m.id}
          className="ticker-item flex max-w-full items-center gap-1.5 rounded-2xl bg-slate-900/60 py-1 pr-3 pl-1 text-xs text-white shadow-lift backdrop-blur-sm"
        >
          <AvatarImage avatar={m.avatar} seed={m.playerId} name={m.name} className="h-6 w-6 shrink-0 rounded-full bg-white/20 text-[10px]" />
          <p className="min-w-0 leading-snug">
            <span className="font-bold text-amber-200">{m.name}</span>{' '}
            {/* Plain text node: never rendered as HTML. */}
            <span className="font-semibold break-words [overflow-wrap:anywhere]">{m.text}</span>
          </p>
        </div>
      ))}
    </div>
  );
}
