import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchRoomInfo } from '../lib/api';
import { getMyAvatar } from '../lib/avatar';
import { noteServerTime, serverNow, syncClock } from '../lib/clock';
import type { FinishedResult, MovePayload, PublicPlayer, RoomSnapshot, SessionAck, TimerPayload } from '../lib/protocol';
import { forgetSession, getSavedName, getStoredSessions, getTabSession, saveName, saveSession } from '../lib/session';
import { request, socket } from '../lib/socket';

export type Phase = 'connecting' | 'need-name' | 'ready' | 'not-found' | 'replaced' | 'closed' | 'error';

export interface Me {
  role: 'player' | 'spectator';
  playerId: string | null;
}

export interface GameRoomEvents {
  onMove?(move: MovePayload): void;
  onStarted?(): void;
  onFinished?(result: FinishedResult): void;
  onPlayerJoined?(player: PublicPlayer): void;
  onPlayerDisconnected?(playerId: string): void;
  onPlayerReconnected?(playerId: string): void;
}

type EnterResult =
  | { kind: 'ok'; me: Me; state: RoomSnapshot }
  | { kind: 'not-found' }
  | { kind: 'need-name'; hostName: string | null; hostAvatar: string | null; hostNameStyle: string | null; hostAvatarFrame: string | null; boardSize: number | null; turnMs: number | null }
  | { kind: 'error'; message: string };

/**
 * Seat resolution, in order:
 *   1. this tab's session (reload)          → reconnect, taking over the old socket
 *   2. other sessions saved in this browser → reconnect only if that seat is offline
 *   3. otherwise                             → join as a new player (or spectator if full)
 *
 * Before step 3, a first-time visitor (no saved name) who would get a seat is
 * asked for a name first, so the seat isn't taken while they're still typing.
 */
async function enterRoom(roomId: string, forceTakeover: boolean, promptForName: boolean): Promise<EnterResult> {
  const tab = getTabSession(roomId);
  const candidates = [
    ...(tab ? [{ token: tab.token, takeover: true }] : []),
    ...getStoredSessions(roomId)
      .filter((s) => s.token !== tab?.token)
      .map((s) => ({ token: s.token, takeover: forceTakeover })),
  ];

  for (const c of candidates) {
    // The avatar may have changed (lobby, another tab) since this seat was taken.
    const res = await request<SessionAck>('player:reconnect', { roomId, token: c.token, takeover: c.takeover, avatar: getMyAvatar() });
    if (res.ok) {
      saveSession(roomId, res.playerId!, res.token!);
      return { kind: 'ok', me: { role: 'player', playerId: res.playerId! }, state: res.state };
    }
    if (res.error === 'ROOM_NOT_FOUND') {
      forgetSession(roomId);
      return { kind: 'not-found' };
    }
    if (res.error === 'INVALID_SESSION') forgetSession(roomId, c.token);
    if (res.error === 'TIMEOUT') return { kind: 'error', message: res.message };
  }

  if (promptForName && !getSavedName()) {
    const info = await fetchRoomInfo(roomId);
    if (info && !info.exists) return { kind: 'not-found' };
    if (info?.seatAvailable) {
      return {
        kind: 'need-name',
        hostName: info.hostName ?? null,
        hostAvatar: info.hostAvatar ?? null,
        hostNameStyle: info.hostNameStyle ?? null,
        hostAvatarFrame: info.hostAvatarFrame ?? null,
        boardSize: info.boardSize ?? null,
        turnMs: info.turnMs ?? null,
      };
    }
    // Room full → join as spectator without asking; API unreachable → just join.
  }

  const res = await request<SessionAck>('room:join', { roomId, name: getSavedName() || undefined, avatar: getMyAvatar() });
  if (!res.ok) {
    return res.error === 'ROOM_NOT_FOUND' ? { kind: 'not-found' } : { kind: 'error', message: res.message };
  }
  if (res.role === 'player' && res.playerId && res.token) {
    saveSession(roomId, res.playerId, res.token);
    return { kind: 'ok', me: { role: 'player', playerId: res.playerId }, state: res.state };
  }
  return { kind: 'ok', me: { role: 'spectator', playerId: null }, state: res.state };
}

// De-duplicates concurrent entries for the same socket (React StrictMode mounts effects twice).
const inflight = new Map<string, Promise<EnterResult>>();
function enterOnce(roomId: string, forceTakeover = false, promptForName = true) {
  const key = `${socket.id}:${roomId}:${forceTakeover}:${promptForName}`;
  let p = inflight.get(key);
  if (!p) {
    p = enterRoom(roomId, forceTakeover, promptForName).finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  return p;
}

export function useGameRoom(roomId: string, events: GameRoomEvents) {
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [me, setMe] = useState<Me>({ role: 'spectator', playerId: null });
  const [phase, setPhase] = useState<Phase>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(socket.connected);
  const [result, setResult] = useState<FinishedResult | null>(null);
  const [invite, setInvite] = useState<{ hostName: string | null; hostAvatar: string | null; hostNameStyle: string | null; hostAvatarFrame: string | null; boardSize: number | null; turnMs: number | null } | null>(
    null,
  );
  /** Bumped every time this socket (re)takes its seat, so dependents (chat, voice) can resync. */
  const [epoch, setEpoch] = useState(0);

  const eventsRef = useRef(events);
  useEffect(() => {
    eventsRef.current = events;
  });
  const versionRef = useRef(0);
  const phaseRef = useRef<Phase>('connecting');
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  const roomRef = useRef<RoomSnapshot | null>(null);

  const applyState = useCallback(
    (s: RoomSnapshot) => {
      if (s.id !== roomId || s.version < versionRef.current) return;
      versionRef.current = s.version;
      roomRef.current = s;
      noteServerTime(s.serverNow);
      setRoom(s);
    },
    [roomId],
  );

  const enter = useCallback(
    async (forceTakeover = false, promptForName = true) => {
      const res = await enterOnce(roomId, forceTakeover, promptForName);
      if (res.kind === 'need-name') {
        setInvite({ hostName: res.hostName, hostAvatar: res.hostAvatar, hostNameStyle: res.hostNameStyle, hostAvatarFrame: res.hostAvatarFrame, boardSize: res.boardSize, turnMs: res.turnMs });
        setPhase('need-name');
      } else if (res.kind === 'ok') {
        versionRef.current = 0;
        setMe(res.me);
        applyState(res.state);
        setError(null);
        setPhase('ready');
        setEpoch((n) => n + 1);
      } else if (res.kind === 'not-found') {
        setPhase('not-found');
      } else {
        setError(res.message);
        setPhase((p) => (p === 'ready' ? p : 'error'));
      }
    },
    [roomId, applyState],
  );

  useEffect(() => {
    versionRef.current = 0;
    roomRef.current = null;
    setRoom(null);
    setResult(null);
    setPhase('connecting');

    const onConnect = () => {
      setConnected(true);
      // Don't silently steal the seat back from the tab that replaced us.
      if (phaseRef.current !== 'replaced' && phaseRef.current !== 'closed') void enter();
    };
    const onDisconnect = () => setConnected(false);
    const mine = (payload: { roomId?: string }) => payload?.roomId === roomId;

    const onMove = (m: MovePayload) => mine(m) && eventsRef.current.onMove?.(m);
    const onStarted = (p: { roomId: string }) => mine(p) && eventsRef.current.onStarted?.();
    const onFinished = (r: FinishedResult) => {
      if (!mine(r)) return;
      setResult(r);
      eventsRef.current.onFinished?.(r);
    };
    const onJoined = (p: { roomId: string; player: PublicPlayer }) => mine(p) && eventsRef.current.onPlayerJoined?.(p.player);
    const onDisc = (p: { roomId: string; playerId: string }) => mine(p) && eventsRef.current.onPlayerDisconnected?.(p.playerId);
    const onRecon = (p: { roomId: string; playerId: string }) => mine(p) && eventsRef.current.onPlayerReconnected?.(p.playerId);
    const onReplaced = (p: { roomId: string }) => mine(p) && setPhase('replaced');
    const onClosed = (p: { roomId: string }) => mine(p) && setPhase('closed');
    const onTimer = (t: TimerPayload) => {
      // If our clock estimate drifted (sleeping laptop, throttled tab), resync.
      if (mine(t) && Math.abs(serverNow() - t.serverNow) > 1_500) void syncClock(3);
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('room:state', applyState);
    socket.on('game:move', onMove);
    socket.on('game:started', onStarted);
    socket.on('game:finished', onFinished);
    socket.on('game:timer', onTimer);
    socket.on('player:joined', onJoined);
    socket.on('player:disconnected', onDisc);
    socket.on('player:reconnected', onRecon);
    socket.on('session:replaced', onReplaced);
    socket.on('room:closed', onClosed);

    if (socket.connected) onConnect();
    else socket.connect();

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('room:state', applyState);
      socket.off('game:move', onMove);
      socket.off('game:started', onStarted);
      socket.off('game:finished', onFinished);
      socket.off('game:timer', onTimer);
      socket.off('player:joined', onJoined);
      socket.off('player:disconnected', onDisc);
      socket.off('player:reconnected', onRecon);
      socket.off('session:replaced', onReplaced);
      socket.off('room:closed', onClosed);
    };
  }, [roomId, enter, applyState]);

  // ─── Actions ───────────────────────────────────────────────────────────────

  const move = useCallback(
    (index: number) => request('game:move', { roomId, index, seq: roomRef.current?.game?.moveCount ?? 0 }),
    [roomId],
  );
  const resign = useCallback(() => request('game:resign', { roomId }), [roomId]);
  const rematch = useCallback((accept: boolean) => request('game:rematch', { roomId, accept }), [roomId]);
  /** Pre-match ready check: the first round starts once both players have confirmed. */
  const ready = useCallback((value: boolean) => request('room:ready', { roomId, ready: value }), [roomId]);
  const rename = useCallback((name: string) => request<{ name: string }>('player:rename', { roomId, name }), [roomId]);
  /** Opponent and spectators get the change through the room:state broadcast. */
  const setAvatar = useCallback((avatar: string) => request<{ avatar: string }>('player:avatar', { roomId, avatar }), [roomId]);
  const leave = useCallback(async () => {
    await request('room:leave', { roomId }, 3_000);
    forgetSession(roomId);
  }, [roomId]);
  /** Joins after the name prompt. */
  const join = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      if (trimmed) saveName(trimmed);
      setPhase('connecting');
      void enter(false, false);
    },
    [enter],
  );
  /** Reclaims the seat after another tab took it over. */
  const reclaim = useCallback(() => {
    setPhase('connecting');
    void enter(true);
  }, [enter]);
  const retry = useCallback(() => {
    setPhase('connecting');
    if (!socket.connected) socket.connect();
    else void enter();
  }, [enter]);

  return { room, me, phase, error, connected, result, invite, epoch, actions: { move, resign, rematch, ready, rename, setAvatar, leave, join, reclaim, retry } };
}
