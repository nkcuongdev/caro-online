import { useMemo, useSyncExternalStore } from 'react';
import type { ReactionsApi } from '../../hooks/useReactions';
import { STANDS_MAX_LENGTH, type StandsApi } from '../../hooks/useStands';
import { ChatPanel } from './ChatPanel';
import { ReactionPicker } from './ReactionPicker';

interface StandsPanelProps {
  stands: StandsApi;
  viewers: number;
  /** Players read the stands after the game but can't post there. */
  readOnly?: boolean;
  /** Show the emoji row under the thread (drawer on phones). */
  withReactions?: boolean;
  className?: string;
}

/** The spectators' "Khán đài" thread: the chat panel with stands labels. */
export function StandsPanel({ stands, viewers, readOnly, withReactions, className }: StandsPanelProps) {
  return (
    <ChatPanel
      chat={stands}
      myId={stands.me?.id ?? null}
      opponentName={null}
      canTalk={stands.canPost && !readOnly}
      title="Khán đài"
      subtitle={viewers > 0 ? `${viewers} người đang xem` : 'Bình luận của khán giả'}
      emptyText={readOnly ? 'Khán giả chưa bình luận gì.' : 'Chưa có bình luận nào. Mở màn đi nào! 🎉'}
      placeholder="Bình luận… (Enter để gửi)"
      disabledPlaceholder={readOnly ? 'Chỉ khán giả mới bình luận được' : 'Đang vào khán đài…'}
      maxLength={STANDS_MAX_LENGTH}
      className={className}
      footer={
        withReactions && !readOnly ? (
          <ReactionPicker variant="row" onPick={stands.react} coolingDown={stands.reactCoolingDown} disabled={!stands.canPost} />
        ) : undefined
      }
    />
  );
}

/** Adapts the stands to the ReactionPanel used by players (reactions float over the board instead of a card). */
export function useStandsReactions(stands: StandsApi): ReactionsApi {
  const { react, reactCoolingDown } = stands;
  return useMemo(() => ({ shown: {}, coolingDown: reactCoolingDown, send: react, show: () => {} }), [react, reactCoolingDown]);
}

// ─── Players' "show floating reactions" preference ────────────────────────────

const HYPE_KEY = 'caro:hype';
const listeners = new Set<() => void>();
/** In-memory copy, so the toggle still works when storage is blocked. */
let memory: boolean | null = null;
const readHype = () => {
  if (memory !== null) return memory;
  try {
    return localStorage.getItem(HYPE_KEY) !== 'off';
  } catch {
    return true;
  }
};
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};
function writeHype(on: boolean) {
  memory = on;
  try {
    localStorage.setItem(HYPE_KEY, on ? 'on' : 'off');
  } catch {
    /* storage unavailable: the choice lasts until reload */
  }
  listeners.forEach((fn) => fn());
}

export function useHypeEnabled() {
  const on = useSyncExternalStore(subscribe, readHype, () => true);
  return [on, writeHype] as const;
}
