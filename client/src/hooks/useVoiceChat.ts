import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { VoiceSignalEvent, VoiceState, VoiceStateEvent } from '../lib/protocol';
import { request, socket } from '../lib/socket';
import { VoiceChat, type VoiceSnapshot } from '../lib/voice/voiceChat';

interface Options {
  roomId: string;
  myId: string | null;
  opponent: { id: string; online: boolean } | null;
  /** Seated player on a live socket. Going inactive (disconnect, seat lost) tears everything down. */
  active: boolean;
  onNotice?: (message: string) => void;
}

export interface VoiceApi extends VoiceSnapshot {
  enable(): void;
  disable(): void;
  toggleMute(): void;
  toggleOpponentMuted(): void;
  retry(): void;
  applySync(states: Record<string, VoiceState>): void;
}

const IDLE: VoiceSnapshot = {
  status: 'off',
  enabled: false,
  muted: false,
  opponentMuted: false,
  localSpeaking: false,
  remoteSpeaking: false,
  remote: { enabled: false, muted: false },
  error: null,
};
const noopSubscribe = () => () => {};
const idle = () => IDLE;

export function useVoiceChat({ roomId, myId, opponent, active, onNotice }: Options): VoiceApi {
  const [voice, setVoice] = useState<VoiceChat | null>(null);
  const noticeRef = useRef(onNotice);
  useEffect(() => {
    noticeRef.current = onNotice;
  });

  // One call session per seat. Unmount (leaving the page) releases the mic and the peer connection.
  useEffect(() => {
    if (!myId) return;
    const v = new VoiceChat({ roomId, myId, emit: (event, payload) => request(event, payload, 5_000) });
    setVoice(v);
    return () => {
      v.destroy();
      setVoice(null);
    };
  }, [roomId, myId]);

  const snap = useSyncExternalStore(voice?.subscribe ?? noopSubscribe, voice?.getSnapshot ?? idle, idle);

  const opponentId = opponent?.id ?? null;
  const opponentOnline = opponent?.online ?? false;
  useEffect(() => {
    if (!voice) return;
    if (!active) voice.reset();
    else voice.setOpponent(opponentId, opponentOnline);
  }, [voice, active, opponentId, opponentOnline]);

  useEffect(() => {
    if (!voice) return;
    const mine = (p: { roomId?: string }) => p?.roomId === roomId;
    const onState = (e: VoiceStateEvent) => mine(e) && voice.setRemoteState(e.playerId, e);
    const onSignal = (e: VoiceSignalEvent) => mine(e) && voice.handleSignal(e.from, e.signal);
    const onDisconnect = () => {
      if (voice.getSnapshot().enabled) noticeRef.current?.('Voice đã tắt vì mất kết nối. Bật lại khi đã kết nối.');
      voice.reset();
    };
    const onReplaced = (p: { roomId: string }) => mine(p) && voice.reset();
    socket.on('voice:state', onState);
    socket.on('voice:signal', onSignal);
    socket.on('disconnect', onDisconnect);
    socket.on('session:replaced', onReplaced);
    return () => {
      socket.off('voice:state', onState);
      socket.off('voice:signal', onSignal);
      socket.off('disconnect', onDisconnect);
      socket.off('session:replaced', onReplaced);
    };
  }, [voice, roomId]);

  const enable = useCallback(() => void voice?.enable(), [voice]);
  const disable = useCallback(() => voice?.disable(), [voice]);
  const toggleMute = useCallback(() => voice?.setMuted(!voice.getSnapshot().muted), [voice]);
  const toggleOpponentMuted = useCallback(() => voice?.setOpponentMuted(!voice.getSnapshot().opponentMuted), [voice]);
  const retry = useCallback(() => voice?.retry(), [voice]);
  const applySync = useCallback(
    (states: Record<string, VoiceState>) => {
      if (opponentId && states[opponentId]) voice?.setRemoteState(opponentId, states[opponentId]);
    },
    [voice, opponentId],
  );

  return { ...snap, enable, disable, toggleMute, toggleOpponentMuted, retry, applySync };
}
