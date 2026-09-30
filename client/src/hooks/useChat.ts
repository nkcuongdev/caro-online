import { useCallback, useEffect, useRef, useState } from 'react';
import { CHAT_MAX_LENGTH, CHAT_MIN_INTERVAL_MS, chatLength } from '../lib/comms';
import type { ChatMessage } from '../lib/protocol';
import { request, socket } from '../lib/socket';
import { sfx } from '../lib/sound';

interface Options {
  roomId: string;
  /** Seated player with an opponent to talk to. */
  active: boolean;
  /** Chat panel is on screen: incoming messages count as read. */
  visible: boolean;
  opponentId: string | null;
  /** Called for every sticker message (ours once the server accepts it, theirs on arrival). */
  onSticker?: (message: ChatMessage) => void;
}

export interface ChatApi {
  messages: ChatMessage[];
  unread: number;
  draft: string;
  setDraft(text: string): void;
  sending: boolean;
  error: string | null;
  send(): Promise<void>;
  sendSticker(id: string): Promise<void>;
  setHistory(messages: ChatMessage[]): void;
}

const byTime = (a: ChatMessage, b: ChatMessage) => a.at - b.at;

function merge(list: ChatMessage[], incoming: ChatMessage[]) {
  const seen = new Set(list.map((m) => m.id));
  const added = incoming.filter((m) => !seen.has(m.id));
  return added.length ? [...list, ...added].sort(byTime) : list;
}

export function useChat({ roomId, active, visible, opponentId, onSticker }: Options): ChatApi {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [unread, setUnread] = useState(0);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const visibleRef = useRef(visible);
  const lastSentAt = useRef(0);
  const errorTimer = useRef<number | undefined>(undefined);
  const onStickerRef = useRef(onSticker);
  useEffect(() => {
    onStickerRef.current = onSticker;
  });

  useEffect(() => {
    visibleRef.current = visible;
    if (visible) setUnread(0);
  }, [visible]);

  // A different opponent (or room) starts a fresh conversation.
  useEffect(() => {
    setMessages([]);
    setUnread(0);
  }, [roomId, opponentId]);

  useEffect(() => {
    if (!active) return;
    const onMessage = (m: ChatMessage) => {
      if (m?.roomId !== roomId) return;
      setMessages((list) => merge(list, [m]));
      if (m.sticker) onStickerRef.current?.(m);
      if (!visibleRef.current) {
        setUnread((n) => n + 1);
        sfx.message();
      }
    };
    socket.on('chat:message', onMessage);
    return () => {
      socket.off('chat:message', onMessage);
    };
  }, [active, roomId]);

  useEffect(() => () => window.clearTimeout(errorTimer.current), []);

  const flash = useCallback((message: string) => {
    setError(message);
    window.clearTimeout(errorTimer.current);
    errorTimer.current = window.setTimeout(() => setError(null), 2_800);
  }, []);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending || !active) return;
    if (chatLength(text) > CHAT_MAX_LENGTH) return flash(`Tin nhắn tối đa ${CHAT_MAX_LENGTH} ký tự.`);
    if (Date.now() - lastSentAt.current < CHAT_MIN_INTERVAL_MS) return flash('Chậm lại một chút nhé.');
    lastSentAt.current = Date.now();
    setSending(true);
    const res = await request<{ message: ChatMessage }>('chat:send', { roomId, text }, 5_000);
    setSending(false);
    if (res.ok) {
      setMessages((list) => merge(list, [res.message]));
      setDraft('');
      setError(null);
    } else {
      flash(res.message);
    }
  }, [draft, sending, active, roomId, flash]);

  const sendSticker = useCallback(
    async (id: string) => {
      if (sending || !active) return;
      if (Date.now() - lastSentAt.current < CHAT_MIN_INTERVAL_MS) return flash('Chậm lại một chút nhé.');
      lastSentAt.current = Date.now();
      setSending(true);
      const res = await request<{ message: ChatMessage }>('chat:sticker', { roomId, sticker: id }, 5_000);
      setSending(false);
      if (res.ok) {
        setMessages((list) => merge(list, [res.message]));
        onStickerRef.current?.(res.message);
      } else {
        flash(res.message);
      }
    },
    [sending, active, roomId, flash],
  );

  const setHistory = useCallback((history: ChatMessage[]) => {
    // History is authoritative for this pairing; keep anything that arrived meanwhile.
    setMessages((list) => merge(history.slice().sort(byTime), list));
  }, []);

  return { messages, unread, draft, setDraft, sending, error, send, sendSticker, setHistory };
}
