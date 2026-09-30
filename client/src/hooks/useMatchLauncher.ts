import { useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import type { TournamentSnapshot } from '../lib/protocol';
import { saveSession } from '../lib/session';
import { activeMatchOf } from '../lib/tournament';
import type { TournamentMe } from './useTournament';

/**
 * Sends a participant into their match room. The tournament token is also the
 * seat token in every match room, so saving it as this tab's room session lets
 * the game page reclaim the seat.
 *
 * Moves the player automatically only when their ready check turns into a live
 * match while they watch, so a player who deliberately opened the bracket
 * mid-match isn't bounced back.
 */
export function useMatchLauncher(t: TournamentSnapshot | null, me: TournamentMe, currentRoomId?: string) {
  const navigate = useNavigate();
  const myMatch = t ? activeMatchOf(t, me.participantId) : null;

  const go = useCallback(
    (roomId: string) => {
      if (me.participantId && me.token) saveSession(roomId, me.participantId, me.token);
      navigate(`/game/${roomId}`);
    },
    [me.participantId, me.token, navigate],
  );

  const prev = useRef<{ id: string; status: string } | null>(null);
  const id = myMatch?.id ?? null;
  const status = myMatch?.status ?? null;
  const roomId = myMatch?.roomId ?? null;
  useEffect(() => {
    const before = prev.current;
    prev.current = id && status ? { id, status } : null;
    if (status === 'LIVE' && roomId && roomId !== currentRoomId && before?.id === id && before.status === 'READY_CHECK') go(roomId);
  }, [id, status, roomId, currentRoomId, go]);

  return { myMatch, go };
}
