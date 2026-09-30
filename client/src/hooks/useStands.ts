import { useCallback, useEffect, useRef, useState } from 'react';
import { getMyAvatar } from '../lib/avatar';
import { chatLength } from '../lib/comms';
import type { ChatMessage, StandsCheers, StandsHype, StandsViewer } from '../lib/protocol';
import { getSavedName } from '../lib/session';
import { request, socket } from '../lib/socket';
import type { ChatApi } from './useChat';

export const STANDS_MAX_LENGTH = 160;
const POST_INTERVAL_MS = 1_000;
const REACT_COOLDOWN_MS = 800;
const HYPE_VISIBLE_MS = 2_600;
const MAX_HYPE_ON_SCREEN = 18;
const TICKER_VISIBLE_MS = 6_000;
const MAX_TICKER = 4;
const CHEER_COOLDOWN_MS = 1_600;

export interface FloatingHype extends StandsHype {
  /** Horizontal lane, 0..1, so bursts spread out instead of stacking. */
  lane: number;
  mine: boolean;
}

interface Options {
  roomId: string;
  role: 'player' | 'spectator';
  /** On a live socket with a resolved seat. */
  active: boolean;
  /** A game is running: players can't see stands comments now. */
  live: boolean;
  /** Bumped by useGameRoom whenever the seat is (re)established. */
  epoch: number;
  /** The stands thread is on screen (clears unread). */
  visible: boolean;
}

export interface StandsApi extends ChatApi {
  me: StandsViewer | null;
  /** Spectators can post; players only read, and only after the game. */
  canPost: boolean;
  react(emoji: string): void;
  reactCoolingDown: boolean;
  hype: FloatingHype[];
  /** Fans per player id. */
  cheers: Record<string, number>;
  /** Player this spectator cheers for. */
  supports: string | null;
  cheer(playerId: string | null): void;
  cheerCoolingDown: boolean;
  /** Players, during a game: the latest comments sliding over the board. */
  ticker: ChatMessage[];
}

const byTime = (a: ChatMessage, b: ChatMessage) => a.at - b.at;
function merge(list: ChatMessage[], incoming: ChatMessage[]) {
  const seen = new Set(list.map((m) => m.id));
  const added = incoming.filter((m) => !seen.has(m.id));
  return added.length ? [...list, ...added].sort(byTime).slice(-80) : list;
}

export function useStands({ roomId, role, active, live, epoch, visible }: Options): StandsApi {
  const [me, setMe] = useState<StandsViewer | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [unread, setUnread] = useState(0);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reactCoolingDown, setReactCoolingDown] = useState(false);
  const [hype, setHype] = useState<FloatingHype[]>([]);
  const [cheers, setCheers] = useState<Record<string, number>>({});
  const [supports, setSupports] = useState<string | null>(null);
  const [cheerCoolingDown, setCheerCoolingDown] = useState(false);
  const [ticker, setTicker] = useState<ChatMessage[]>([]);
  const liveRef = useRef(live);
  useEffect(() => {
    liveRef.current = live;
    if (!live) setTicker([]);
  }, [live]);
  const visibleRef = useRef(visible);
  const meRef = useRef<StandsViewer | null>(null);
  const lastPostAt = useRef(0);
  const timers = useRef(new Set<number>());
  const spectator = role === 'spectator';

  const later = useCallback((fn: () => void, ms: number) => {
    const t = window.setTimeout(() => {
      timers.current.delete(t);
      fn();
    }, ms);
    timers.current.add(t);
  }, []);
  useEffect(() => {
    const set = timers.current;
    return () => {
      set.forEach((t) => window.clearTimeout(t));
      set.clear();
    };
  }, []);

  useEffect(() => {
    visibleRef.current = visible;
    if (visible) setUnread(0);
  }, [visible]);

  useEffect(() => {
    setMessages([]);
    setUnread(0);
    setMe(null);
    meRef.current = null;
    setCheers({});
    setSupports(null);
    setTicker([]);
  }, [roomId, role]);

  // Spectators take a seat in the stands after every (re)join; players read the thread once the game is over.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    if (spectator) {
      void request<{ viewer: StandsViewer; messages: ChatMessage[]; cheers: Record<string, number>; supports: string | null }>('stands:join', {
        roomId,
        name: getSavedName() || undefined,
        avatar: getMyAvatar(),
      }).then((res) => {
        if (cancelled || !res.ok) return;
        meRef.current = res.viewer;
        setMe(res.viewer);
        setMessages((list) => merge(res.messages, list));
        setCheers(res.cheers);
        setSupports(res.supports);
      });
    } else {
      // Fan counts always; the thread itself only arrives once the game is over.
      void request<{ messages: ChatMessage[]; cheers: Record<string, number> }>('stands:sync', { roomId }).then((res) => {
        if (cancelled || !res.ok) return;
        setMessages((list) => merge(res.messages, list));
        setCheers(res.cheers);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [active, spectator, live, roomId, epoch]);

  useEffect(() => {
    if (!active) return;
    const mine = (p: { roomId?: string }) => p?.roomId === roomId;
    const onMessage = (m: ChatMessage) => {
      if (!mine(m)) return;
      setMessages((list) => merge(list, [m]));
      if (!visibleRef.current && m.playerId !== meRef.current?.id) setUnread((n) => n + 1);
      // Players see live comments slide over the board (the server already filtered out move advice).
      if (!spectator && liveRef.current && m.text) {
        setTicker((list) => [...list.filter((x) => x.id !== m.id), m].slice(-MAX_TICKER));
        later(() => setTicker((list) => list.filter((x) => x.id !== m.id)), TICKER_VISIBLE_MS);
      }
    };
    const onCheers = (c: StandsCheers) => mine(c) && setCheers(c.cheers);
    const onHype = (h: StandsHype) => {
      if (!mine(h)) return;
      const item: FloatingHype = { ...h, lane: Math.random(), mine: h.viewerId === meRef.current?.id };
      setHype((list) => [...list, item].slice(-MAX_HYPE_ON_SCREEN));
      later(() => setHype((list) => list.filter((x) => x.id !== h.id)), HYPE_VISIBLE_MS);
    };
    socket.on('stands:message', onMessage);
    socket.on('stands:hype', onHype);
    socket.on('stands:cheers', onCheers);
    return () => {
      socket.off('stands:message', onMessage);
      socket.off('stands:hype', onHype);
      socket.off('stands:cheers', onCheers);
    };
  }, [active, roomId, later, spectator]);

  const flash = useCallback(
    (message: string) => {
      setError(message);
      later(() => setError((e) => (e === message ? null : e)), 2_800);
    },
    [later],
  );

  const canPost = spectator && active && !!me;

  /** Shared pacing for comments and stickers (the server enforces the real limits). */
  const paced = useCallback(() => {
    if (Date.now() - lastPostAt.current < POST_INTERVAL_MS) {
      flash('Chậm lại một chút nhé.');
      return false;
    }
    lastPostAt.current = Date.now();
    return true;
  }, [flash]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending || !canPost) return;
    if (chatLength(text) > STANDS_MAX_LENGTH) return flash(`Bình luận tối đa ${STANDS_MAX_LENGTH} ký tự.`);
    if (!paced()) return;
    setSending(true);
    const res = await request<{ message: ChatMessage }>('stands:chat', { roomId, text }, 5_000);
    setSending(false);
    if (res.ok) {
      setMessages((list) => merge(list, [res.message]));
      setDraft('');
    } else flash(res.message);
  }, [draft, sending, canPost, roomId, flash, paced]);

  const sendSticker = useCallback(
    async (id: string) => {
      if (sending || !canPost || !paced()) return;
      setSending(true);
      const res = await request<{ message: ChatMessage }>('stands:sticker', { roomId, sticker: id }, 5_000);
      setSending(false);
      if (res.ok) setMessages((list) => merge(list, [res.message]));
      else flash(res.message);
    },
    [sending, canPost, roomId, flash, paced],
  );

  const react = useCallback(
    (emoji: string) => {
      if (!canPost || reactCoolingDown) return;
      setReactCoolingDown(true);
      later(() => setReactCoolingDown(false), REACT_COOLDOWN_MS);
      // No optimistic float: the server echoes it to everyone, us included, unless the room cap drops it.
      void request('stands:react', { roomId, emoji }, 4_000);
    },
    [canPost, reactCoolingDown, roomId, later],
  );

  const cheer = useCallback(
    (playerId: string | null) => {
      if (!canPost || cheerCoolingDown) return;
      setCheerCoolingDown(true);
      later(() => setCheerCoolingDown(false), CHEER_COOLDOWN_MS);
      setSupports(playerId);
      void request<{ supports: string | null; cheers: Record<string, number> }>('stands:cheer', { roomId, playerId }, 4_000).then((res) => {
        if (res.ok) {
          setSupports(res.supports);
          setCheers(res.cheers);
        } else flash(res.message);
      });
    },
    [canPost, cheerCoolingDown, roomId, later, flash],
  );

  const setHistory = useCallback((history: ChatMessage[]) => setMessages((list) => merge(history, list)), []);

  return {
    me,
    canPost,
    messages,
    unread,
    draft,
    setDraft,
    sending,
    error,
    send,
    sendSticker,
    setHistory,
    react,
    reactCoolingDown,
    hype,
    cheers,
    supports,
    cheer,
    cheerCoolingDown,
    ticker,
  };
}
