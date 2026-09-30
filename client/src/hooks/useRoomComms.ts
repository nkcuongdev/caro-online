import { useCallback, useEffect } from 'react';
import type { ChatMessage, CommsSync } from '../lib/protocol';
import { request } from '../lib/socket';
import { useChat } from './useChat';
import { useReactions } from './useReactions';
import { useVoiceChat } from './useVoiceChat';

interface Options {
  roomId: string;
  myId: string | null;
  /** The other human in the room (bots and empty seats are null). */
  opponent: { id: string; online: boolean } | null;
  /** Seated player on a live socket. */
  active: boolean;
  /** Bumped by useGameRoom whenever the seat is (re)established. */
  epoch: number;
  chatVisible: boolean;
  onNotice?: (message: string) => void;
}

/**
 * Chat, reactions and voice for the two players of a room. Entirely separate
 * from game state: nothing here can block a move or touch the clock.
 */
export function useRoomComms({ roomId, myId, opponent, active, epoch, chatVisible, onNotice }: Options) {
  const opponentId = opponent?.id ?? null;
  const canTalk = active && !!opponentId;

  const reactions = useReactions({ roomId, myId, active: canTalk });
  const { show } = reactions;
  const onSticker = useCallback(
    (m: ChatMessage) => show(m.playerId, { id: `sticker-${m.id}`, emoji: '', sticker: m.sticker }),
    [show],
  );
  const chat = useChat({ roomId, active: canTalk, visible: chatVisible, opponentId, onSticker });
  const voice = useVoiceChat({ roomId, myId, opponent, active, onNotice });

  const { setHistory } = chat;
  const { applySync } = voice;
  // After every (re)join, and when a new opponent sits down: fetch history and voice states.
  useEffect(() => {
    if (!canTalk) return;
    let cancelled = false;
    void request<CommsSync>('comms:sync', { roomId }).then((res) => {
      if (cancelled || !res.ok) return;
      setHistory(res.messages);
      applySync(res.voice);
    });
    return () => {
      cancelled = true;
    };
  }, [canTalk, epoch, roomId, opponentId, setHistory, applySync]);

  return { chat, reactions, voice, canTalk };
}
