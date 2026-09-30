import { useCallback, useEffect, useRef, useState } from 'react';
import { REACTION_COOLDOWN_MS, REACTION_VISIBLE_MS } from '../lib/comms';
import type { ReactionEvent } from '../lib/protocol';
import { request, socket } from '../lib/socket';

export interface ShownReaction {
  id: string;
  emoji: string;
  /** Sticker id, shown instead of the emoji. */
  sticker?: string;
}

export interface ReactionsApi {
  /** Reaction currently floating over each player's card, by player id. */
  shown: Record<string, ShownReaction>;
  coolingDown: boolean;
  send(emoji: string): void;
  /** Floats a reaction (or sticker) over a player's card. */
  show(playerId: string, reaction: ShownReaction): void;
}

interface Options {
  roomId: string;
  myId: string | null;
  active: boolean;
}

let localSeq = 0;

export function useReactions({ roomId, myId, active }: Options): ReactionsApi {
  const [shown, setShown] = useState<Record<string, ShownReaction>>({});
  const [coolingDown, setCoolingDown] = useState(false);
  const hideTimers = useRef(new Map<string, number>());
  const cooldownTimer = useRef<number | undefined>(undefined);

  const show = useCallback((playerId: string, reaction: ShownReaction) => {
    setShown((s) => ({ ...s, [playerId]: reaction }));
    window.clearTimeout(hideTimers.current.get(playerId));
    hideTimers.current.set(
      playerId,
      window.setTimeout(() => {
        hideTimers.current.delete(playerId);
        setShown((s) => {
          if (s[playerId]?.id !== reaction.id) return s;
          const { [playerId]: _gone, ...rest } = s;
          return rest;
        });
      }, REACTION_VISIBLE_MS),
    );
  }, []);

  useEffect(() => {
    if (!active) return;
    const onReaction = (r: ReactionEvent) => {
      if (r?.roomId === roomId) show(r.playerId, { id: r.id, emoji: r.emoji });
    };
    socket.on('reaction', onReaction);
    return () => {
      socket.off('reaction', onReaction);
    };
  }, [active, roomId, show]);

  useEffect(() => {
    const timers = hideTimers.current;
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      timers.clear();
      window.clearTimeout(cooldownTimer.current);
    };
  }, []);

  const send = useCallback(
    (emoji: string) => {
      if (!active || !myId || coolingDown) return;
      setCoolingDown(true);
      cooldownTimer.current = window.setTimeout(() => setCoolingDown(false), REACTION_COOLDOWN_MS);
      // Shown right away on our own card; the server relays it to the opponent.
      show(myId, { id: `local-${++localSeq}`, emoji });
      void request('reaction:send', { roomId, emoji }, 4_000);
    },
    [active, myId, coolingDown, roomId, show],
  );

  return { shown, coolingDown, send, show };
}
