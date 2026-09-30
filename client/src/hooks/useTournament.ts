import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { getMyAvatar } from '../lib/avatar';
import { noteServerTime } from '../lib/clock';
import type { TournamentSnapshot } from '../lib/protocol';
import { getSavedName, saveName } from '../lib/session';
import { request, socket } from '../lib/socket';
import {
  forgetTournamentSession,
  getStoredTournamentSessions,
  getTabTournamentSession,
  saveTournamentSession,
} from '../lib/tournament';

export type TournamentPhase = 'connecting' | 'ready' | 'not-found' | 'closed' | 'error';

export interface TournamentMe {
  participantId: string | null;
  /** Needed to take this participant's seat in each match room. */
  token: string | null;
}

interface EnterAck {
  role: 'participant' | 'spectator';
  participantId?: string;
  token?: string;
  state: TournamentSnapshot;
}

type EnterResult = { kind: 'ok'; me: TournamentMe; state: TournamentSnapshot } | { kind: 'not-found' } | { kind: 'error'; message: string };

/** Participant spot first (this tab, then this browser), otherwise watch as a spectator. */
async function enterTournament(tournamentId: string): Promise<EnterResult> {
  const tab = getTabTournamentSession(tournamentId);
  const candidates = [
    ...(tab ? [{ token: tab.token, takeover: true }] : []),
    ...getStoredTournamentSessions(tournamentId)
      .filter((s) => s.token !== tab?.token)
      .map((s) => ({ token: s.token, takeover: false })),
  ];
  for (const c of candidates) {
    const res = await request<EnterAck>('tournament:enter', { tournamentId, token: c.token, takeover: c.takeover });
    if (res.ok && res.participantId && res.token) {
      saveTournamentSession(tournamentId, res.participantId, res.token);
      return { kind: 'ok', me: { participantId: res.participantId, token: res.token }, state: res.state };
    }
    if (!res.ok && res.error === 'TOURNAMENT_NOT_FOUND') {
      forgetTournamentSession(tournamentId);
      return { kind: 'not-found' };
    }
    if (!res.ok && res.error === 'INVALID_SESSION') forgetTournamentSession(tournamentId, c.token);
    if (!res.ok && res.error === 'TIMEOUT') return { kind: 'error', message: res.message };
  }
  const res = await request<EnterAck>('tournament:enter', { tournamentId });
  if (!res.ok) return res.error === 'TOURNAMENT_NOT_FOUND' ? { kind: 'not-found' } : { kind: 'error', message: res.message };
  return { kind: 'ok', me: { participantId: null, token: null }, state: res.state };
}

// De-duplicates concurrent entries (StrictMode runs effects twice).
const inflight = new Map<string, Promise<EnterResult>>();
function enterOnce(tournamentId: string) {
  const key = `${socket.id}:${tournamentId}`;
  let p = inflight.get(key);
  if (!p) {
    p = enterTournament(tournamentId).finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  return p;
}

export interface NewTournament {
  name: string;
  size: number;
  bestOf: number;
  boardSize: number;
  turnSeconds: number;
}

/** Creates a tournament with this browser as host, then opens its lobby. */
export function useCreateTournament(onError: (message: string) => void) {
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const create = useCallback(
    async (settings: NewTournament) => {
      setCreating(true);
      const res = await request<{ tournamentId: string; participantId: string; token: string }>('tournament:create', {
        name: settings.name || undefined,
        playerName: getSavedName() || undefined,
        avatar: getMyAvatar(),
        size: settings.size,
        bestOf: settings.bestOf,
        boardSize: settings.boardSize,
        turnSeconds: settings.turnSeconds,
      });
      setCreating(false);
      if (!res.ok) {
        onError(res.message);
        return false;
      }
      saveTournamentSession(res.tournamentId, res.participantId, res.token);
      navigate(`/t/${res.tournamentId}`);
      return true;
    },
    [navigate, onError],
  );
  return { create, creating };
}

export interface TournamentEvents {
  onKicked?(): void;
}

export function useTournament(tournamentId: string, events: TournamentEvents = {}) {
  const [t, setT] = useState<TournamentSnapshot | null>(null);
  const [me, setMe] = useState<TournamentMe>({ participantId: null, token: null });
  const [phase, setPhase] = useState<TournamentPhase>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(socket.connected);
  const versionRef = useRef(0);
  const eventsRef = useRef(events);
  const meRef = useRef(me);
  useEffect(() => {
    eventsRef.current = events;
    meRef.current = me;
  });

  const applyState = useCallback(
    (s: TournamentSnapshot) => {
      if (s.id !== tournamentId || s.version < versionRef.current) return;
      versionRef.current = s.version;
      noteServerTime(s.serverNow);
      setT(s);
    },
    [tournamentId],
  );

  const enter = useCallback(async () => {
    const res = await enterOnce(tournamentId);
    if (res.kind === 'ok') {
      versionRef.current = 0;
      setMe(res.me);
      applyState(res.state);
      setError(null);
      setPhase('ready');
    } else if (res.kind === 'not-found') {
      setPhase('not-found');
    } else {
      setError(res.message);
      setPhase((p) => (p === 'ready' ? p : 'error'));
    }
  }, [tournamentId, applyState]);

  useEffect(() => {
    versionRef.current = 0;
    setT(null);
    setPhase('connecting');
    const mine = (p: { tournamentId?: string }) => p?.tournamentId === tournamentId;
    const onConnect = () => {
      setConnected(true);
      void enter();
    };
    const onDisconnect = () => setConnected(false);
    const onClosed = (p: { tournamentId: string }) => mine(p) && setPhase('closed');
    const onKicked = (p: { tournamentId: string }) => {
      if (!mine(p)) return;
      forgetTournamentSession(tournamentId);
      setMe({ participantId: null, token: null });
      eventsRef.current.onKicked?.();
    };
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('tournament:state', applyState);
    socket.on('tournament:closed', onClosed);
    socket.on('tournament:kicked', onKicked);
    if (socket.connected) onConnect();
    else socket.connect();
    return () => {
      // Spectators stop counting as watchers; participants stay "online" while they're in a match room.
      if (!meRef.current.participantId && socket.connected) {
        socket.emit('tournament:unwatch', { tournamentId });
        // A remount (StrictMode, fast navigation) must enter again after this unwatch, not reuse the old entry.
        inflight.delete(`${socket.id}:${tournamentId}`);
      }
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('tournament:state', applyState);
      socket.off('tournament:closed', onClosed);
      socket.off('tournament:kicked', onKicked);
    };
  }, [tournamentId, enter, applyState]);

  // ─── Actions ───────────────────────────────────────────────────────────────

  const join = useCallback(
    async (name: string) => {
      const trimmed = name.trim();
      if (trimmed) saveName(trimmed);
      const res = await request<{ participantId: string; token: string; state: TournamentSnapshot }>('tournament:join', {
        tournamentId,
        name: trimmed || getSavedName() || undefined,
        avatar: getMyAvatar(),
      });
      if (res.ok) {
        saveTournamentSession(tournamentId, res.participantId, res.token);
        setMe({ participantId: res.participantId, token: res.token });
        applyState(res.state);
      }
      return res;
    },
    [tournamentId, applyState],
  );

  const leave = useCallback(async () => {
    const res = await request('tournament:leave', { tournamentId }, 4_000);
    forgetTournamentSession(tournamentId);
    setMe({ participantId: null, token: null });
    return res;
  }, [tournamentId]);

  const start = useCallback(() => request('tournament:start', { tournamentId }), [tournamentId]);
  const ready = useCallback((matchId: string) => request('tournament:ready', { tournamentId, matchId }), [tournamentId]);
  const kick = useCallback((participantId: string) => request('tournament:kick', { tournamentId, participantId }), [tournamentId]);
  const setAvatar = useCallback((avatar: string) => request('tournament:profile', { tournamentId, avatar }), [tournamentId]);
  const rename = useCallback((name: string) => request('tournament:profile', { tournamentId, name }), [tournamentId]);
  const retry = useCallback(() => {
    setPhase('connecting');
    if (!socket.connected) socket.connect();
    else void enter();
  }, [enter]);

  return { t, me, phase, error, connected, actions: { join, leave, start, ready, kick, setAvatar, rename, retry } };
}
