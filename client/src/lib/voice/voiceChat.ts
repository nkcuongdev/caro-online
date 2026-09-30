import { ICE_SERVERS } from '../env';
import type { Ack, VoiceIceResponse, VoiceSignal, VoiceState } from '../protocol';
import { LevelMeter } from './levelMeter';

export type VoiceStatus =
  | 'off' // mic not enabled
  | 'requesting' // waiting for the browser's mic permission
  | 'waiting' // mic on, opponent hasn't enabled voice (or is offline)
  | 'connecting'
  | 'connected'
  | 'failed'; // WebRTC could not connect; the game is unaffected

export interface VoiceSnapshot {
  status: VoiceStatus;
  /** Local microphone is live (regardless of mute). */
  enabled: boolean;
  muted: boolean;
  /** Opponent's audio silenced locally. */
  opponentMuted: boolean;
  localSpeaking: boolean;
  remoteSpeaking: boolean;
  /** What the opponent last announced. */
  remote: VoiceState;
  error: string | null;
}

export interface VoiceChatOptions {
  roomId: string;
  myId: string;
  emit: (event: string, payload: unknown) => Promise<Ack<object>>;
}

const OFF: VoiceState = { enabled: false, muted: false };
const CONNECT_TIMEOUT_MS = 15_000;
const MAX_AUTO_RETRIES = 2;
const FAILED_TEXT = 'Không kết nối được voice. Mạng có thể đang chặn kết nối trực tiếp.';

/**
 * One player's side of a 1:1 WebRTC audio call.
 *
 * Socket.IO carries only signaling (offer / answer / ICE); audio flows peer
 * to peer. A call exists only while both players have opted in. To avoid
 * offer glare, the player with the smaller id always makes the offer and the
 * other only answers.
 *
 * Every failure path ends in a state the UI can show; nothing here throws
 * into the game, so a denied mic or a blocked network never affects play.
 */
export class VoiceChat {
  private snap: VoiceSnapshot = {
    status: 'off',
    enabled: false,
    muted: false,
    opponentMuted: false,
    localSpeaking: false,
    remoteSpeaking: false,
    remote: OFF,
    error: null,
  };
  private listeners = new Set<() => void>();
  private opponentId: string | null = null;
  private opponentOnline = false;
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private localMeter: LevelMeter | null = null;
  private rawLocalSpeaking = false;
  private remoteMeter: LevelMeter | null = null;
  private pc: RTCPeerConnection | null = null;
  /** From the server (TURN) when it has one, else the built-in list. Refreshed on every enable. */
  private iceServers: RTCIceServer[] = ICE_SERVERS;
  private audio: HTMLAudioElement | null = null;
  private pendingIce: RTCIceCandidateInit[] = [];
  private signals: Promise<void> = Promise.resolve();
  private retries = 0;
  private connectTimer: number | null = null;
  private retryTimer: number | null = null;
  /** Bumped whenever the local mic is torn down, so in-flight async work can tell it's stale. */
  private generation = 0;

  constructor(private readonly opts: VoiceChatOptions) {}

  // ─── Store interface (useSyncExternalStore) ───────────────────────────────

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };

  getSnapshot = () => this.snap;

  private set(patch: Partial<VoiceSnapshot>) {
    this.snap = { ...this.snap, ...patch };
    for (const fn of this.listeners) fn();
  }

  // ─── Inputs from the room ─────────────────────────────────────────────────

  setOpponent(id: string | null, online: boolean) {
    if (id !== this.opponentId) {
      this.opponentId = id;
      this.closePeer();
      this.set({ remote: OFF, remoteSpeaking: false });
    }
    this.opponentOnline = online;
    this.update();
  }

  setRemoteState(playerId: string, state: VoiceState) {
    if (playerId !== this.opponentId) return;
    const prev = this.snap.remote;
    this.set({ remote: { enabled: state.enabled, muted: state.muted } });
    if (!state.enabled) {
      this.closePeer();
    } else if (prev.enabled && prev.muted === state.muted) {
      // Same state announced again = the opponent pressed "retry": start over unless we're fine.
      if (this.pc?.connectionState !== 'connected') {
        this.closePeer();
        this.clearFailure();
      }
    } else if (!prev.enabled) {
      this.clearFailure();
    }
    this.update();
  }

  handleSignal(from: string, signal: VoiceSignal) {
    // Serialized: an ICE candidate must not be applied before its offer/answer.
    this.signals = this.signals
      .then(() => this.processSignal(from, signal))
      .catch((err) => {
        console.warn('[voice] signaling failed', err);
        this.fail(FAILED_TEXT);
      });
  }

  // ─── User actions ─────────────────────────────────────────────────────────

  async enable() {
    if (this.stream || this.snap.status === 'requesting') return;
    if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === 'undefined') {
      this.set({
        error: window.isSecureContext ? 'Trình duyệt này không hỗ trợ voice chat.' : 'Voice chat cần HTTPS (hoặc localhost).',
      });
      return;
    }
    const gen = this.generation;
    this.set({ status: 'requesting', error: null });
    // Created inside the click, so autoplay policies let it run.
    try {
      this.ctx ??= new AudioContext();
      void this.ctx.resume();
    } catch {
      this.ctx = null; // speaking indicators just won't show
    }
    // Fetched while the permission prompt is open, so it rarely adds any wait.
    const ice = this.loadIceServers();

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
    } catch (err) {
      if (gen === this.generation) this.set({ status: 'off', error: micError(err) });
      return;
    }
    if (gen !== this.generation) {
      // Left the room while the permission prompt was open.
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    // No call starts before the announce below, so every peer connection gets these.
    const iceServers = await ice;
    if (gen !== this.generation) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    this.iceServers = iceServers;

    this.stream = stream;
    this.retries = 0;
    const track = stream.getAudioTracks()[0];
    if (track) track.onended = () => this.disable('Micro đã bị ngắt kết nối.');
    if (this.ctx) {
      this.localMeter = new LevelMeter(this.ctx, stream, (s) => {
        this.rawLocalSpeaking = s;
        this.set({ localSpeaking: s && !this.snap.muted });
      });
    }
    this.set({ enabled: true, muted: false, status: 'waiting', error: null });
    const res = await this.announce();
    if (gen !== this.generation) return;
    if (!res.ok) {
      this.disable(res.error === 'TIMEOUT' ? res.message : 'Không bật được voice, hãy thử lại.');
      return;
    }
    this.update();
  }

  /** Turns the mic off and ends the call. `error` is shown to the user, if given. */
  disable(error: string | null = null) {
    const wasOn = !!this.stream || this.snap.status === 'requesting';
    this.teardownLocal();
    this.set({ error });
    if (wasOn) void this.opts.emit('voice:state', { roomId: this.opts.roomId, enabled: false, muted: false });
  }

  setMuted(muted: boolean) {
    if (!this.stream) return;
    for (const t of this.stream.getAudioTracks()) t.enabled = !muted;
    this.set({ muted, localSpeaking: this.rawLocalSpeaking && !muted });
    void this.announce();
  }

  setOpponentMuted(opponentMuted: boolean) {
    if (this.audio) this.audio.muted = opponentMuted;
    this.set({ opponentMuted });
  }

  retry() {
    if (!this.stream) return;
    this.retries = 0;
    this.closePeer();
    this.set({ status: 'connecting', error: null });
    // Re-announcing makes the opponent start over too.
    void this.announce();
    this.update();
  }

  /** Full local cleanup without talking to the server (socket gone, seat lost, page left). */
  reset() {
    this.teardownLocal();
    this.opponentId = null;
    this.opponentOnline = false;
    this.set({ remote: OFF, remoteSpeaking: false, error: null });
  }

  destroy() {
    this.reset();
    this.audio?.remove();
    this.audio = null;
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.listeners.clear();
  }

  // ─── Call lifecycle ───────────────────────────────────────────────────────

  private get isInitiator() {
    return !!this.opponentId && this.opts.myId < this.opponentId;
  }

  /** Reconciles the peer connection with who has voice enabled. */
  private update() {
    if (!this.stream) return;
    const ready = !!this.opponentId && this.opponentOnline && this.snap.remote.enabled;
    if (!ready) {
      this.closePeer();
      this.set({ status: 'waiting' });
      return;
    }
    if (this.pc || this.retryTimer !== null || this.snap.status === 'failed') return;
    if (this.isInitiator) {
      void this.startCall();
    } else {
      this.set({ status: 'connecting' });
      this.armConnectTimeout();
    }
  }

  private async startCall() {
    const pc = this.createPeer();
    try {
      const offer = await pc.createOffer();
      if (pc !== this.pc) return;
      await pc.setLocalDescription(offer);
      if (pc !== this.pc || !pc.localDescription) return;
      await this.signal({ type: 'offer', sdp: pc.localDescription.sdp });
    } catch (err) {
      console.warn('[voice] offer failed', err);
      if (pc === this.pc) this.onFailed();
    }
  }

  private async processSignal(from: string, signal: VoiceSignal) {
    if (from !== this.opponentId || !this.stream) return;

    if (signal.type === 'offer') {
      if (this.isInitiator) return;
      const pc = this.createPeer();
      await pc.setRemoteDescription({ type: 'offer', sdp: signal.sdp });
      await this.flushIce(pc);
      const answer = await pc.createAnswer();
      if (pc !== this.pc) return;
      await pc.setLocalDescription(answer);
      if (pc !== this.pc || !pc.localDescription) return;
      await this.signal({ type: 'answer', sdp: pc.localDescription.sdp });
    } else if (signal.type === 'answer') {
      const pc = this.pc;
      if (!pc || pc.signalingState !== 'have-local-offer') return;
      await pc.setRemoteDescription({ type: 'answer', sdp: signal.sdp });
      await this.flushIce(pc);
    } else if (signal.type === 'ice' && signal.candidate) {
      const pc = this.pc;
      if (pc?.remoteDescription) await pc.addIceCandidate(signal.candidate).catch(() => {});
      else this.pendingIce.push(signal.candidate);
    }
  }

  private createPeer() {
    this.closePeer();
    const stream = this.stream!;
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    this.pc = pc;
    for (const track of stream.getAudioTracks()) pc.addTrack(track, stream);

    pc.onicecandidate = (e) => {
      if (e.candidate && pc === this.pc) void this.signal({ type: 'ice', candidate: e.candidate.toJSON() });
    };
    pc.ontrack = (e) => {
      if (pc === this.pc) this.attachRemote(e.streams[0] ?? new MediaStream([e.track]));
    };
    pc.onconnectionstatechange = () => {
      if (pc !== this.pc) return;
      if (pc.connectionState === 'connected') {
        this.clearConnectTimeout();
        this.retries = 0;
        this.set({ status: 'connected', error: null });
      } else if (pc.connectionState === 'failed') {
        this.onFailed();
      } else if (pc.connectionState === 'disconnected') {
        // Often recovers on its own (brief network hiccup); the timeout catches it if not.
        this.set({ status: 'connecting' });
        this.armConnectTimeout();
      }
    };

    this.set({ status: 'connecting' });
    this.armConnectTimeout();
    return pc;
  }

  private attachRemote(stream: MediaStream) {
    if (!this.audio) {
      const el = document.createElement('audio');
      el.autoplay = true;
      el.setAttribute('playsinline', '');
      el.hidden = true;
      document.body.appendChild(el);
      this.audio = el;
    }
    this.audio.srcObject = stream;
    this.audio.muted = this.snap.opponentMuted;
    void this.audio.play().catch(() => {
      /* autoplay is unlocked by the Enable click; nothing else to do */
    });
    this.remoteMeter?.dispose();
    this.remoteMeter = this.ctx ? new LevelMeter(this.ctx, stream, (s) => this.set({ remoteSpeaking: s })) : null;
  }

  private async flushIce(pc: RTCPeerConnection) {
    const queued = this.pendingIce;
    this.pendingIce = [];
    for (const c of queued) await pc.addIceCandidate(c).catch(() => {});
  }

  private onFailed() {
    this.closePeer();
    if (this.isInitiator && this.retries < MAX_AUTO_RETRIES) {
      this.retries += 1;
      this.set({ status: 'connecting' });
      this.retryTimer = window.setTimeout(() => {
        this.retryTimer = null;
        this.update();
      }, 1_200 * this.retries);
    } else if (!this.isInitiator && this.retries < MAX_AUTO_RETRIES) {
      // The initiator retries and sends a fresh offer; give it time.
      this.retries += 1;
      this.set({ status: 'connecting' });
      this.armConnectTimeout();
    } else {
      this.fail(FAILED_TEXT);
    }
  }

  private fail(error: string) {
    this.closePeer();
    if (this.stream) this.set({ status: 'failed', error });
  }

  private clearFailure() {
    this.retries = 0;
    if (this.snap.status === 'failed') this.set({ status: 'connecting', error: null });
  }

  private armConnectTimeout() {
    this.clearConnectTimeout();
    this.connectTimer = window.setTimeout(() => {
      this.connectTimer = null;
      if (this.snap.status !== 'connected' && this.stream) this.onFailed();
    }, CONNECT_TIMEOUT_MS);
  }

  private clearConnectTimeout() {
    if (this.connectTimer !== null) window.clearTimeout(this.connectTimer);
    this.connectTimer = null;
  }

  private closePeer() {
    this.clearConnectTimeout();
    if (this.retryTimer !== null) window.clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.pendingIce = [];
    this.remoteMeter?.dispose();
    this.remoteMeter = null;
    if (this.pc) {
      const pc = this.pc;
      this.pc = null;
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      pc.close();
    }
    if (this.audio) this.audio.srcObject = null;
    if (this.snap.remoteSpeaking) this.set({ remoteSpeaking: false });
  }

  private teardownLocal() {
    this.generation += 1;
    this.closePeer();
    this.localMeter?.dispose();
    this.localMeter = null;
    this.rawLocalSpeaking = false;
    this.stream?.getTracks().forEach((t) => {
      t.onended = null;
      t.stop();
    });
    this.stream = null;
    this.retries = 0;
    this.set({ status: 'off', enabled: false, muted: false, localSpeaking: false });
  }

  /** TURN servers from the server; any failure or "none configured" means the built-in STUN list. */
  private async loadIceServers(): Promise<RTCIceServer[]> {
    try {
      const res = (await this.opts.emit('voice:ice', { roomId: this.opts.roomId })) as Ack<VoiceIceResponse>;
      return res.ok && res.iceServers?.length ? res.iceServers : ICE_SERVERS;
    } catch {
      return ICE_SERVERS;
    }
  }

  private announce() {
    return this.opts.emit('voice:state', { roomId: this.opts.roomId, enabled: !!this.stream, muted: this.snap.muted });
  }

  private async signal(signal: VoiceSignal) {
    const res = await this.opts.emit('voice:signal', { roomId: this.opts.roomId, signal });
    // NO_OPPONENT: the opponent turned voice off mid-handshake; their voice:state event handles it.
    if (!res.ok && res.error !== 'NO_OPPONENT' && signal.type !== 'ice') throw new Error(res.message);
  }
}

function micError(err: unknown): string {
  const name = err instanceof DOMException || err instanceof Error ? err.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Bạn đã từ chối quyền dùng micro. Hãy cho phép micro trong cài đặt trình duyệt rồi thử lại.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'Không tìm thấy micro trên thiết bị này.';
    case 'NotReadableError':
    case 'AbortError':
      return 'Micro đang bị ứng dụng khác sử dụng.';
    default:
      return 'Không bật được micro.';
  }
}
