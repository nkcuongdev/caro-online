import { useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import type { ChatApi } from '../../hooks/useChat';
import { CHAT_MAX_LENGTH, chatLength } from '../../lib/comms';
import { cx } from '../../lib/cx';
import type { ChatMessage } from '../../lib/protocol';
import { AvatarWithFrame } from '../AvatarWithFrame';
import { PlayerName } from '../PlayerName';
import { ChatIcon, SendIcon, StickerIcon } from '../icons';
import { StickerArt, StickerPicker } from './StickerPicker';

interface ChatPanelProps {
  chat: ChatApi;
  myId: string | null;
  opponentName: string | null;
  canTalk: boolean;
  /** Current avatar of a player still in the room; messages fall back to the avatar they were sent with. */
  avatarOf?: (playerId: string) => string | null | undefined;
  /** Current name style of a player still in the room (messages don't carry one). */
  nameStyleOf?: (playerId: string) => string | null | undefined;
  /** Current avatar frame of a player still in the room (messages don't carry one). */
  avatarFrameOf?: (playerId: string) => string | null | undefined;
  /** Rendered between the message list and the input (the mobile reaction row). */
  footer?: ReactNode;
  className?: string;
  /** Labels, so the same panel serves the spectators' stands. */
  title?: string;
  subtitle?: string;
  emptyText?: string;
  placeholder?: string;
  disabledPlaceholder?: string;
  maxLength?: number;
}

const timeFmt = new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit' });

export function ChatPanel({
  chat,
  myId,
  opponentName,
  canTalk,
  avatarOf,
  nameStyleOf,
  avatarFrameOf,
  footer,
  className,
  title = 'Trò chuyện',
  subtitle = 'Chỉ 2 người chơi thấy',
  emptyText,
  placeholder = 'Nhắn tin… (Enter để gửi)',
  disabledPlaceholder = 'Đang chờ đối thủ…',
  maxLength = CHAT_MAX_LENGTH,
}: ChatPanelProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const [stickersOpen, setStickersOpen] = useState(false);
  const count = chat.messages.length;

  // Follow new messages, unless the reader scrolled up to read older ones.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [count]);

  const onScroll = () => {
    const el = listRef.current;
    if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    stickToBottom.current = true;
    void chat.send();
  };

  // Don't send half-composed text from an IME (e.g. Vietnamese Telex on macOS).
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && e.nativeEvent.isComposing) e.preventDefault();
  };

  const onChange = (value: string) => {
    // Cap by characters (emoji = 1), not UTF-16 units like the `maxLength` attribute does.
    chat.setDraft(chatLength(value) > maxLength ? Array.from(value).slice(0, maxLength).join('') : value);
  };

  const sendSticker = (id: string) => {
    stickToBottom.current = true;
    void chat.sendSticker(id);
  };

  const length = chatLength(chat.draft);

  return (
    <section
      aria-label="Trò chuyện"
      className={cx('flex min-h-0 flex-col overflow-hidden rounded-3xl bg-white/90 shadow-soft ring-1 ring-slate-200/70', className)}
    >
      <header className="flex shrink-0 items-center gap-2 px-4 pt-3 pb-1.5">
        <ChatIcon size={16} className="text-brand-500" />
        <h2 className="font-display text-[15px] font-bold text-slate-700">{title}</h2>
        <span className="ml-auto truncate text-[11px] font-semibold text-slate-400">{subtitle}</span>
      </header>

      <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={listRef}
        onScroll={onScroll}
        role="log"
        aria-live="polite"
        className="board-scroll flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3 py-2"
      >
        {count === 0 ? (
          <p className="m-auto max-w-[220px] py-6 text-center text-xs font-semibold text-slate-400">
            {emptyText ?? (canTalk ? `Gửi lời chào tới ${opponentName ?? 'đối thủ'} 👋` : 'Khi có đối thủ trong phòng, hai bạn có thể trò chuyện tại đây.')}
          </p>
        ) : (
          chat.messages.map((m, i) => (
            <Bubble
              key={m.id}
              message={m}
              mine={m.playerId === myId}
              grouped={chat.messages[i - 1]?.playerId === m.playerId}
              avatar={avatarOf?.(m.playerId) ?? m.avatar}
              nameStyle={nameStyleOf?.(m.playerId)}
              avatarFrame={avatarFrameOf?.(m.playerId)}
            />
          ))
        )}
      </div>

      {stickersOpen && canTalk && (
        <>
          {/* Tapping the uncovered part of the conversation closes the tray. */}
          <div className="animate-fade-in absolute inset-0 z-10 bg-white/50" onClick={() => setStickersOpen(false)} aria-hidden="true" />
          <div
            className="animate-fade-up absolute inset-x-0 bottom-0 z-10 flex h-56 max-h-full flex-col rounded-t-2xl border-t border-slate-100 bg-white px-2 pt-2 shadow-[0_-8px_24px_-12px_rgb(15_23_42/0.25)]"
            onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), setStickersOpen(false))}
          >
            <StickerPicker onPick={sendSticker} disabled={chat.sending} className="min-h-0 flex-1" />
          </div>
        </>
      )}
      </div>

      {footer && !stickersOpen && <div className="shrink-0 border-t border-slate-100 px-3 pt-2">{footer}</div>}

      <form onSubmit={submit} className="shrink-0 border-t border-slate-100 p-2.5">
        {chat.error && (
          <p role="alert" className="animate-fade-in mb-1.5 px-1 text-xs font-semibold text-red-500">
            {chat.error}
          </p>
        )}
        <div className="flex items-center gap-2">
          <label htmlFor="chat-input" className="sr-only">
            Tin nhắn
          </label>
          <button
            type="button"
            onClick={() => setStickersOpen((o) => !o)}
            disabled={!canTalk}
            aria-label={stickersOpen ? 'Đóng sticker' : 'Mở sticker'}
            aria-expanded={stickersOpen}
            title="Sticker"
            className={cx(
              'grid h-10 w-10 shrink-0 place-items-center rounded-2xl transition-colors disabled:opacity-40',
              stickersOpen ? 'bg-brand-100 text-brand-600' : 'text-slate-400 hover:bg-brand-50 hover:text-brand-600',
            )}
          >
            <StickerIcon size={20} />
          </button>
          <input
            id="chat-input"
            value={chat.draft}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={!canTalk}
            placeholder={canTalk ? placeholder : disabledPlaceholder}
            autoComplete="off"
            enterKeyHint="send"
            className="h-10 min-w-0 flex-1 rounded-2xl bg-slate-50 px-3.5 text-sm font-semibold text-slate-700 ring-1 ring-slate-200 outline-none transition-shadow placeholder:font-medium placeholder:text-slate-400 focus:bg-white focus:ring-4 focus:ring-brand-100 disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={!canTalk || !chat.draft.trim() || chat.sending}
            aria-label="Gửi"
            title="Gửi (Enter)"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-gradient-to-b from-brand-400 to-brand-600 text-white shadow-[0_6px_16px_-6px_rgb(37_99_235/0.55)] transition-all hover:-translate-y-0.5 active:scale-95 disabled:pointer-events-none disabled:opacity-40"
          >
            <SendIcon size={17} />
          </button>
        </div>
        {length > maxLength - 40 && (
          <p className={cx('mt-1 px-1 text-right text-[11px] font-bold tabular', length >= maxLength ? 'text-red-500' : 'text-slate-400')}>
            {length}/{maxLength}
          </p>
        )}
      </form>
    </section>
  );
}

function Bubble({
  message,
  mine,
  grouped,
  avatar,
  nameStyle,
  avatarFrame,
}: {
  message: ChatMessage;
  mine: boolean;
  grouped: boolean;
  avatar: string | null;
  nameStyle?: string | null;
  avatarFrame?: string | null;
}) {
  if (mine) return <BubbleBody message={message} mine grouped={grouped} className="max-w-[85%] self-end" />;
  // The opponent's avatar sits beside the first message of each run.
  return (
    <div className={cx('animate-fade-up flex max-w-[85%] items-start gap-1.5 self-start', !grouped && 'mt-1.5')}>
      {grouped ? (
        <span className="w-7 shrink-0" />
      ) : (
        <AvatarWithFrame avatar={avatar} frameId={avatarFrame} seed={message.playerId} name={message.name} className="mt-0.5 h-7 w-7 rounded-xl bg-slate-100 text-[11px]" animated={false} />
      )}
      <BubbleBody message={message} mine={false} grouped className="min-w-0" showName={!grouped} nameStyle={nameStyle} />
    </div>
  );
}

function BubbleBody({
  message,
  mine,
  grouped,
  showName = false,
  nameStyle,
  className,
}: {
  message: ChatMessage;
  mine: boolean;
  grouped: boolean;
  showName?: boolean;
  nameStyle?: string | null;
  className?: string;
}) {
  return (
    <div className={cx('flex flex-col', mine ? 'animate-fade-up items-end' : 'items-start', mine && !grouped && 'mt-1.5', className)}>
      {showName && <PlayerName name={message.name} nameStyle={nameStyle} className="mb-0.5 px-1 text-[11px] font-bold text-slate-400" />}
      {message.sticker ? (
        <div title={timeFmt.format(message.at)} className="animate-pop-in">
          <StickerArt id={message.sticker} className="h-24 w-24" />
        </div>
      ) : (
      <div
        className={cx(
          'rounded-2xl px-3 py-1.5 text-sm leading-snug font-semibold',
          mine ? 'rounded-br-md bg-brand-500 text-white' : 'rounded-bl-md bg-slate-100 text-slate-700',
        )}
        title={timeFmt.format(message.at)}
      >
        {/* Plain text node: React escapes it, so HTML in a message is shown, never run. */}
        <p className="break-words whitespace-pre-wrap [overflow-wrap:anywhere]">{message.text}</p>
      </div>
      )}
    </div>
  );
}
