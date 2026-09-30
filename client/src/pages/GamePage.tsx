import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { GameBoard } from '../components/GameBoard';
import { GameStatus, type StatusTone } from '../components/GameStatus';
import { ChatPanel } from '../components/comms/ChatPanel';
import { CommsDrawer } from '../components/comms/CommsDrawer';
import { ReactionPanel } from '../components/comms/ReactionPanel';
import { CheerBar } from '../components/comms/CheerBar';
import { CommentTicker } from '../components/comms/CommentTicker';
import { HypeLayer } from '../components/comms/HypeLayer';
import { ReactionPicker } from '../components/comms/ReactionPicker';
import { StandsPanel, useHypeEnabled, useStandsReactions } from '../components/comms/StandsPanel';
import { VoicePanel } from '../components/comms/VoicePanel';
import {
  BookIcon,
  BotIcon,
  ChatIcon,
  CopyIcon,
  EyeIcon,
  FlagIcon,
  LinkIcon,
  LogOutIcon,
  MicIcon,
  MicOffIcon,
  RematchIcon,
  SparkIcon,
  TrophyIcon,
  VolumeOffIcon,
  VolumeOnIcon,
} from '../components/icons';
import { useCopyInvite } from '../components/InvitePanel';
import { InviteNameModal } from '../components/InviteNameModal';
import { ConfirmDialog } from '../components/Modal';
import { PlayerCard } from '../components/PlayerCard';
import { ResultModal, type TournamentOutcome } from '../components/ResultModal';
import { TournamentMatchBar } from '../components/tournament/TournamentMatchBar';
import { RulesModal } from '../components/RulesModal';
import { StartCountdown } from '../components/StartCountdown';
import { useToast } from '../components/Toasts';
import { AccountMenu } from '../components/auth/AccountMenu';
import { noteSeatName } from '../lib/account';
import { Button, Card, IconButton, Logo, Spinner } from '../components/ui';
import { ReadyCheck, WaitingForReturn, WaitingRoom } from '../components/WaitingRoom';
import { useGameRoom } from '../hooks/useGameRoom';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { useRoomComms } from '../hooks/useRoomComms';
import { useStands } from '../hooks/useStands';
import { useSound } from '../hooks/useSound';
import { useServerNow } from '../lib/clock';
import { celebrate } from '../lib/confetti';
import { cx } from '../lib/cx';
import { resultFromSnapshot, resultLine, seatPlayers } from '../lib/game';
import type { BotDifficulty, Mark, RoomSnapshot } from '../lib/protocol';
import { setMyAvatar } from '../lib/avatar';
import { saveName } from '../lib/session';
import { sfx } from '../lib/sound';
import { roundName } from '../lib/tournament';
import { winsNeeded } from '../lib/protocol';

export function GamePage() {
  const { roomId = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [soundOn, setSoundOn] = useSound();
  const [pending, setPending] = useState<number | null>(null);
  const [follow, setFollow] = useState<number | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [confirm, setConfirm] = useState<null | 'resign' | 'leave'>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const { copy: copyInvite } = useCopyInvite(roomId);

  const roomRef = useRef<RoomSnapshot | null>(null);
  const myIdRef = useRef<string | null>(null);
  const nameOf = (id: string) => roomRef.current?.players.find((p) => p.id === id)?.name ?? 'Đối thủ';

  const { room, me, phase, error, connected, result: eventResult, invite, epoch, actions } = useGameRoom(roomId, {
    onMove(m) {
      if (m.playerId === myIdRef.current) return;
      sfx.place(false);
      setFollow(m.index);
    },
    onFinished(r) {
      const mine = r.players.find((p) => p.id === myIdRef.current);
      if (!r.winner) sfx.join();
      else if (!mine) {
        sfx.win();
        celebrate();
      } else if (mine.mark === r.winner) {
        sfx.win();
        window.setTimeout(celebrate, 350);
      } else sfx.lose();
    },
    onPlayerJoined(p) {
      if (p.id === myIdRef.current) return;
      toast(`${p.name} đã vào phòng`, 'success');
      sfx.join();
    },
    onPlayerDisconnected(id) {
      if (id !== myIdRef.current) toast(`${nameOf(id)} đã mất kết nối`, 'warning');
    },
    onPlayerReconnected(id) {
      if (id !== myIdRef.current) toast(`${nameOf(id)} đã kết nối lại`, 'success');
    },
  });

  useEffect(() => {
    roomRef.current = room;
    myIdRef.current = me.playerId;
  });

  // ─── Derived state ─────────────────────────────────────────────────────────

  const game = room?.game ?? null;
  const size = room?.config.boardSize ?? 20;
  const countdownActive = !!game && !game.finished && Date.now() < game.startAt + 5_000;
  const now = useServerNow(250, countdownActive);
  const started = !!game && now >= game.startAt;
  const playing = room?.status === 'PLAYING' && !!game && !game.finished;
  const myPlayer = room?.players.find((p) => p.id === me.playerId) ?? null;
  const myMark = myPlayer?.mark ?? null;
  const isPlayer = !!myPlayer;
  // A guest who never typed a name plays under one the server picked: signing up offers that one.
  const myName = myPlayer?.name ?? null;
  useEffect(() => {
    noteSeatName(myName);
    return () => noteSeatName(null);
  }, [myName]);
  const myTurn = playing && started && !!myMark && game!.currentTurn === myMark;
  const canMove = myTurn && connected && pending === null;
  const seats = seatPlayers(room?.players ?? []);

  const vsBot = room?.mode === 'bot';
  /** Set when this room plays a tournament bracket match. */
  const tlink = room?.tournament ?? null;
  const botThinking = playing && started && !!seats[game!.currentTurn]?.isBot;

  // ─── Chat / reactions / voice (two people only, never with a bot) ──────────

  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const [commsOpen, setCommsOpen] = useState(false);
  const opponent = room?.players.find((p) => p.id !== me.playerId && !p.isBot) ?? null;
  const showComms = isPlayer && !vsBot;
  const comms = useRoomComms({
    roomId,
    myId: isPlayer ? me.playerId : null,
    opponent: opponent ? { id: opponent.id, online: opponent.online } : null,
    active: phase === 'ready' && connected && showComms,
    epoch,
    chatVisible: isDesktop || commsOpen,
    onNotice: (message) => toast(message, 'warning'),
  });
  const { voice, reactions, chat } = comms;

  // ─── Stands: spectators' comments, stickers and floating reactions ─────────
  // Players never receive stands comments while a game is live (no coaching);
  // they can read them afterwards. Floating reactions reach everyone.

  const isSpectator = !!room && !isPlayer;
  const [standsOpen, setStandsOpen] = useState(false);
  const [hypeOn, setHypeOn] = useHypeEnabled();
  const stands = useStands({
    roomId,
    role: isPlayer ? 'player' : 'spectator',
    active: phase === 'ready' && connected && !!room,
    live: !!playing,
    epoch,
    visible: isSpectator ? isDesktop || standsOpen : standsOpen,
  });
  const standsReactions = useStandsReactions(stands);
  const sideOf = (playerId: string) => (seats.X?.id === playerId ? 'X' : seats.O?.id === playerId ? 'O' : null);
  const fans = Object.values(stands.cheers).reduce((n, c) => n + c, 0);
  // The cheer bar shows up once someone is watching (spectators use it to pick a side).
  const showCheerBar = !!room && room.players.length === 2 && (isSpectator || fans > 0);
  // Players' stands view is read-only and only makes sense between games.
  const playerStandsAvailable = isPlayer && !playing && stands.messages.length > 0;
  useEffect(() => {
    if (playing && isPlayer) setStandsOpen(false);
  }, [playing, isPlayer]);

  // Voice problems surface as a toast when the voice panel isn't on screen.
  const voiceError = voice.error;
  const voicePanelVisible = isDesktop || commsOpen;
  useEffect(() => {
    if (voiceError && !voicePanelVisible) toast(voiceError, 'warning');
  }, [voiceError, voicePanelVisible, toast]);

  // A live mic isn't a call: audio flows only once both players turn voice on.
  // When the panel that explains this is hidden, tell each side what's missing.
  const voiceOpponent = opponent?.name ?? 'Đối thủ';
  const voiceWaiting = voice.enabled && voice.status === 'waiting' && !!opponent?.online && !voice.remote.enabled;
  useEffect(() => {
    if (voiceWaiting && !voicePanelVisible) toast(`Micro đã bật, nhưng ${voiceOpponent} cần bấm “Bật voice” thì mới nghe được bạn.`, 'info');
  }, [voiceWaiting, voicePanelVisible, voiceOpponent, toast]);
  const voiceInvite = !voice.enabled && voice.remote.enabled && comms.canTalk;
  const voiceLive = voice.status === 'connected';
  useEffect(() => {
    if (voiceInvite && !voicePanelVisible) toast(`${voiceOpponent} đã bật voice. Mở “Chat & voice” và bấm “Bật voice” để nghe và nói chuyện.`, 'info');
  }, [voiceInvite, voicePanelVisible, voiceOpponent, toast]);

  const result =
    room?.status === 'FINISHED' ? (eventResult && eventResult.round === room.round ? eventResult : resultFromSnapshot(room)) : null;

  // Open the result modal shortly after a game ends, so the winning line is visible first.
  const shownRound = useRef<number | null>(null);
  useEffect(() => {
    if (!result || shownRound.current === result.round) return;
    shownRound.current = result.round;
    const t = window.setTimeout(() => setModalOpen(true), 900);
    return () => window.clearTimeout(t);
  }, [result]);

  // New round (rematch or new opponent): reset local UI.
  const lastRound = useRef<number | null>(null);
  useEffect(() => {
    if (!room) return;
    if (lastRound.current !== null && room.round > lastRound.current && room.status === 'PLAYING') {
      setModalOpen(false);
      setPending(null);
      setFollow(null);
      if (myMark) toast(`Ván ${room.round} — bạn cầm quân ${myMark}`, 'info');
      sfx.join();
    }
    lastRound.current = room.round;
  }, [room, myMark, toast]);

  // Pre-match ready check: let players know when the other side confirms.
  const seenReady = useRef<string[]>([]);
  useEffect(() => {
    const votes = room?.status === 'WAITING' ? room.readyVotes : [];
    for (const id of votes) {
      if (seenReady.current.includes(id) || id === me.playerId) continue;
      const who = room?.players.find((p) => p.id === id);
      if (who) toast(`${who.name} đã sẵn sàng`, 'success');
      sfx.join();
    }
    seenReady.current = votes;
  }, [room, me.playerId, toast]);

  // Clear the optimistic piece once the server has settled the move either way.
  useEffect(() => {
    if (pending === null || !game) return;
    if (game.board[pending] !== '.' || !myTurn) setPending(null);
  }, [game, pending, myTurn]);

  // Tab title doubles as a notification when the tab is in the background.
  useEffect(() => {
    document.title = myTurn ? '● Đến lượt bạn — Caro Online' : result ? 'Kết thúc ván — Caro Online' : `Phòng ${roomId} — Caro Online`;
    return () => {
      document.title = 'Caro Online';
    };
  }, [myTurn, result, roomId]);

  // ─── Actions ───────────────────────────────────────────────────────────────

  const onCellClick = async (index: number) => {
    if (!room || !game || !isPlayer) return;
    if (!canMove) {
      if (playing && started && !myTurn) toast(botThinking ? 'Bot đang suy nghĩ…' : 'Chưa đến lượt của bạn', 'info');
      return;
    }
    if (game.board[index] !== '.') return;
    setPending(index);
    sfx.place(true);
    const res = await actions.move(index);
    if (!res.ok) {
      setPending(null);
      sfx.error();
      if (res.error !== 'STALE_MOVE') toast(res.message, 'error');
    }
  };

  const doResign = async () => {
    setConfirm(null);
    const res = await actions.resign();
    if (!res.ok) toast(res.message, 'error');
  };

  const doLeave = async () => {
    setConfirm(null);
    await actions.leave();
    navigate(tlink ? `/t/${tlink.id}` : '/');
  };

  const onRematch = async (accept: boolean) => {
    const res = await actions.rematch(accept);
    if (!res.ok) toast(res.message, 'error');
  };

  const onRename = async (name: string) => {
    saveName(name);
    const res = await actions.rename(name);
    if (!res.ok) toast(res.message, 'error');
  };

  /** Saved for next time only once the room accepted it, so the card never disagrees with what others see. */
  const onChangeAvatar = async (avatar: string) => {
    const res = await actions.setAvatar(avatar);
    if (!res.ok) {
      toast(res.message, 'error');
      return false;
    }
    setMyAvatar(avatar);
    return true;
  };
  const liveAvatarOf = (playerId: string) => room?.players.find((p) => p.id === playerId)?.avatar;
  const liveNameStyleOf = (playerId: string) => room?.players.find((p) => p.id === playerId)?.nameStyle;
  const liveAvatarFrameOf = (playerId: string) => room?.players.find((p) => p.id === playerId)?.avatarFrame;

  // ─── Non-ready phases ──────────────────────────────────────────────────────

  if (phase === 'need-name') {
    return (
      <Shell>
        <InviteNameModal
          roomId={roomId}
          hostName={invite?.hostName ?? null}
          hostAvatar={invite?.hostAvatar ?? null}
          hostNameStyle={invite?.hostNameStyle ?? null}
          hostAvatarFrame={invite?.hostAvatarFrame ?? null}
          boardSize={invite?.boardSize ?? null}
          turnMs={invite?.turnMs ?? null}
          onJoin={actions.join}
        />
      </Shell>
    );
  }

  if (phase !== 'ready' || !room) {
    return (
      <Shell>
        <PhaseScreen phase={phase} roomId={roomId} error={error} onRetry={actions.retry} onReclaim={actions.reclaim} />
      </Shell>
    );
  }

  // ─── Status line ───────────────────────────────────────────────────────────

  let status: { tone: StatusTone; text: string; mark?: Mark | null };
  if (!connected) status = { tone: 'warning', text: 'Mất kết nối — đang kết nối lại…' };
  else if (room.status === 'WAITING') {
    const offline = room.players.find((p) => !p.online);
    const iReady = !!me.playerId && room.readyVotes.includes(me.playerId);
    status =
      room.players.length < 2
        ? { tone: 'waiting', text: isPlayer ? 'Đang chờ đối thủ' : 'Đang chờ người chơi' }
        : offline
          ? { tone: 'waiting', text: `Đang chờ ${offline.name} kết nối lại` }
          : !isPlayer
            ? { tone: 'waiting', text: 'Đang chờ hai người chơi sẵn sàng' }
            : iReady
              ? { tone: 'waiting', text: 'Đang chờ đối thủ sẵn sàng' }
              : { tone: 'turn', text: 'Bấm “Sẵn sàng” để bắt đầu' };
  } else if (result) status = { tone: 'success', text: resultLine(result) };
  else if (game && !started) status = { tone: 'neutral', text: 'Chuẩn bị…' };
  else if (game) {
    const turnName = seats[game.currentTurn]?.name ?? `Người chơi ${game.currentTurn}`;
    if (myTurn) status = { tone: 'turn', text: `Đến lượt bạn — đánh quân ${myMark}`, mark: myMark };
    else if (botThinking) status = { tone: 'waiting', text: 'Bot đang suy nghĩ', mark: game.currentTurn };
    else if (seats[game.currentTurn] && !seats[game.currentTurn]!.online)
      status = { tone: 'waiting', text: `${turnName} mất kết nối — đồng hồ tạm dừng`, mark: game.currentTurn };
    else if (!isPlayer) status = { tone: 'neutral', text: `Lượt của ${turnName}`, mark: game.currentTurn };
    else status = { tone: 'waiting', text: `Đang chờ ${turnName}`, mark: game.currentTurn };
  } else status = { tone: 'neutral', text: '' };

  /** Mic indicator for a player card: shown once that player has voice enabled. */
  const voiceFor = (playerId: string) => {
    // "Speaking" only once the call is up; before that nobody hears it.
    if (playerId === me.playerId) return voice.enabled ? { muted: voice.muted, speaking: voiceLive && voice.localSpeaking } : null;
    if (playerId !== opponent?.id || !voice.remote.enabled) return null;
    return { muted: voice.remote.muted, speaking: voice.status === 'connected' && voice.remoteSpeaking && !voice.remote.muted };
  };

  const cardFor = (seat: Mark) => {
    const p = seats[seat];
    const isYou = !!p && p.id === me.playerId;
    const isTurn = !!p && playing && started && game!.currentTurn === p.mark;
    const statusText = isTurn
      ? isYou
        ? 'Lượt của bạn'
        : 'Đang suy nghĩ…'
      : result && p?.mark && result.winner === p.mark
        ? 'Chiến thắng!'
        : playing && started
          ? 'Đang chờ'
          : room.status === 'WAITING' && room.players.length === 2
            ? 'Chưa sẵn sàng'
            : 'Trực tuyến';
    return (
      <PlayerCard
        seat={seat}
        player={p}
        isYou={isYou}
        isTurn={isTurn}
        deadline={isTurn ? game!.deadline : null}
        pausedMs={isTurn ? (game!.pausedRemainingMs ?? null) : null}
        turnMs={room.config.turnMs}
        statusText={statusText}
        callout={
          !p
            ? null
            : room.status === 'FINISHED' && room.rematchVotes.includes(p.id)
              ? 'Muốn chơi lại!'
              : room.status === 'WAITING' && room.readyVotes.includes(p.id)
                ? 'Đã sẵn sàng!'
                : null
        }
        isWinner={!!result?.winner && result.winner === p?.mark}
        onRename={isYou ? onRename : undefined}
        onChangeAvatar={isYou ? onChangeAvatar : undefined}
        reaction={p && showComms ? (reactions.shown[p.id] ?? null) : null}
        voice={p && showComms ? voiceFor(p.id) : null}
      />
    );
  };

  let overlay: ReactNode = null;
  if (room.status === 'WAITING') {
    const offline = room.players.find((p) => !p.online);
    overlay =
      room.players.length < 2 ? (
        <WaitingRoom roomId={room.id} boardSize={size} turnMs={room.config.turnMs} />
      ) : offline ? (
        <WaitingForReturn name={offline.name} nameStyle={offline.nameStyle} />
      ) : (
        <ReadyCheck players={room.players} readyVotes={room.readyVotes} myId={me.playerId} onReady={actions.ready} />
      );
  } else if (playing && game && !started) {
    overlay = <StartCountdown startAt={game.startAt} />;
  }

  // Tournament match: what the result means for the bracket.
  let tournamentOutcome: TournamentOutcome | undefined;
  if (tlink && result) {
    const toBracket = () => navigate(`/t/${tlink.id}`);
    const isFinal = tlink.round === tlink.totalRounds - 1;
    const next = isFinal ? '' : roundName(tlink.round + 1, tlink.totalRounds);
    const winnerName = result.winner ? (seats[result.winner]?.name ?? `Người chơi ${result.winner}`) : '';
    // Best-of series: room wins are the series score; the match is only over at a majority (or a walk-out).
    const bestOf = tlink.bestOf ?? 1;
    const winnerWins = result.winner ? (seats[result.winner]?.wins ?? 0) : 0;
    const seriesOver = bestOf <= 1 || winnerWins >= winsNeeded(bestOf) || result.reason === 'left' || result.reason === 'abandoned';
    const score = (() => {
      const [a, b] = [seats.X?.wins ?? 0, seats.O?.wins ?? 0];
      const mine = myMark === 'O' ? [b, a] : [a, b];
      return isPlayer ? `${mine[0]}–${mine[1]}` : `${seats.X?.name ?? 'X'} ${a}–${b} ${seats.O?.name ?? 'O'}`;
    })();
    if (!result.winner) {
      tournamentOutcome = {
        headline: 'Hòa — đấu lại!',
        detail:
          bestOf > 1
            ? 'Ván hòa không được tính. Ván mới bắt đầu sau ít giây, hai bên đổi quân.'
            : 'Trận loại trực tiếp phải có người thắng. Ván mới bắt đầu sau ít giây, hai bên đổi quân.',
        tone: 'neutral',
        onBracket: toBracket,
      };
    } else if (!seriesOver) {
      const won = isPlayer && myMark === result.winner;
      tournamentOutcome = {
        headline: isPlayer ? (won ? `Bạn thắng ván ${room.round}!` : `Bạn thua ván ${room.round}`) : `${winnerName} thắng ván ${room.round}`,
        detail: `Tỉ số BO${bestOf}: ${score}. Ván tiếp theo bắt đầu sau ít giây, hai bên đổi quân.`,
        tone: won ? 'win' : isPlayer ? 'lose' : 'neutral',
        onBracket: toBracket,
      };
    } else if (isPlayer && myMark === result.winner) {
      tournamentOutcome = {
        headline: isFinal ? 'Bạn là nhà vô địch!' : `Bạn vào ${next}!`,
        detail: isFinal ? 'Chiếc cúp đã thuộc về bạn.' : 'Khi có đối thủ, lời mời “Sẵn sàng” sẽ hiện ra ngay tại đây.',
        tone: 'win',
        onBracket: toBracket,
      };
    } else if (isPlayer) {
      tournamentOutcome = {
        headline: `Bạn dừng bước ở ${roundName(tlink.round, tlink.totalRounds).toLowerCase()}`,
        detail: 'Ở lại xem các trận còn lại và cổ vũ nhé.',
        tone: 'lose',
        onBracket: toBracket,
      };
    } else {
      tournamentOutcome = {
        headline: isFinal ? `${winnerName} vô địch!` : `${winnerName} vào ${next}`,
        detail: 'Mở bracket để theo dõi các trận tiếp theo.',
        tone: 'neutral',
        onBracket: toBracket,
      };
    }
  }

  const iWantRematch = !!me.playerId && room.rematchVotes.includes(me.playerId);
  const theyWantRematch = room.rematchVotes.some((id) => id !== me.playerId);

  const controls = (
    <>
      {isPlayer && playing && (
        <Button variant="danger" size="sm" className="h-10" icon={<FlagIcon size={16} />} onClick={() => setConfirm('resign')}>
          Đầu hàng
        </Button>
      )}
      {isPlayer && room.status === 'FINISHED' && room.players.length === 2 && !tlink && (
        <Button
          variant={theyWantRematch && !iWantRematch ? 'success' : iWantRematch ? 'soft' : 'primary'}
          size="sm"
          className={cx('h-10', theyWantRematch && !iWantRematch && 'animate-pulse-soft')}
          icon={<RematchIcon size={16} />}
          onClick={() => onRematch(!iWantRematch)}
        >
          {iWantRematch ? 'Đang chờ… (hủy)' : theyWantRematch ? 'Đồng ý chơi lại' : 'Chơi lại'}
        </Button>
      )}
      {result && (
        <Button variant="secondary" size="sm" className="h-10" icon={<TrophyIcon size={16} />} onClick={() => setModalOpen(true)}>
          Kết quả
        </Button>
      )}
      {tlink && (
        <Button variant="secondary" size="sm" className="h-10" icon={<TrophyIcon size={16} />} onClick={() => navigate(`/t/${tlink.id}`)}>
          Bracket
        </Button>
      )}
      {room.status !== 'WAITING' && !vsBot && !tlink && (
        <Button variant="secondary" size="sm" className="h-10" icon={<LinkIcon size={16} />} onClick={copyInvite}>
          <span className="sm:hidden">Link mời</span>
          <span className="hidden sm:inline">Sao chép link mời</span>
        </Button>
      )}
    </>
  );

  // Desktop: voice + reactions under the left card, chat under the right one.
  // Phones/tablets: everything in a bottom sheet opened from the controls row.
  const desktopComms = showComms && isDesktop;
  const desktopStands = isSpectator && isDesktop;
  const voicePanel = (
    <VoicePanel
      voice={voice}
      opponentName={opponent?.name ?? null}
      opponentOnline={!!opponent?.online}
      canTalk={comms.canTalk}
      className="shrink-0"
    />
  );
  const asideClass = (col: string) =>
    cx(
      col,
      'row-start-1 min-w-0 pt-2.5',
      desktopComms || desktopStands ? 'board-scroll lg:-mx-2 lg:flex lg:min-h-0 lg:flex-col lg:gap-4 lg:overflow-y-auto lg:px-2 lg:pt-3 lg:pb-1' : 'lg:self-center lg:pt-0',
    );
  const unread = chat.unread;
  const mobileComms = showComms && !isDesktop && (
    <>
      <Button variant="secondary" size="sm" className="relative h-10" icon={<ChatIcon size={16} />} onClick={() => setCommsOpen(true)}>
        Chat & voice
        {unread > 0 ? (
          <span className="animate-pop-in absolute -top-1.5 -right-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-coral-500 px-1 text-[11px] font-bold text-white ring-2 ring-white">
            {unread > 9 ? '9+' : unread}
          </span>
        ) : (
          voiceInvite && <span className="animate-pulse-soft absolute -top-1 -right-1 h-3 w-3 rounded-full bg-emerald-500 ring-2 ring-white" />
        )}
      </Button>
      {voice.enabled && (
        // Green (and pulsing while you talk) only when the call is connected;
        // amber means the mic is on but the opponent can't hear you yet.
        <IconButton
          label={voice.muted ? 'Bật mic' : voiceLive ? 'Tắt mic' : 'Tắt mic · voice chưa kết nối'}
          aria-pressed={voice.muted}
          onClick={voice.toggleMute}
          className={cx(
            // `!` so the tone beats IconButton's own text colour.
            voice.muted ? 'text-red-500!' : voiceLive ? 'text-emerald-600!' : 'text-amber-500!',
            voiceLive && voice.localSpeaking && 'animate-speaking',
          )}
        >
          {voice.muted ? <MicOffIcon size={18} /> : <MicIcon size={18} />}
        </IconButton>
      )}
    </>
  );

  const standsUnread = stands.unread;
  const standsButton = (isSpectator ? !isDesktop : playerStandsAvailable) && (
    <Button variant="secondary" size="sm" className="relative h-10" icon={<EyeIcon size={16} />} onClick={() => setStandsOpen(true)}>
      Khán đài
      {standsUnread > 0 && (
        <span className="animate-pop-in absolute -top-1.5 -right-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-violet-500 px-1 text-[11px] font-bold text-white ring-2 ring-white">
          {standsUnread > 9 ? '9+' : standsUnread}
        </span>
      )}
    </Button>
  );

  return (
    <div className="flex h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-[1760px] items-center justify-between gap-2 px-3 py-2.5 sm:px-5 sm:py-3">
        <div className="flex min-w-0 items-center gap-2 sm:gap-4">
          <Logo responsive />
          {vsBot ? (
            <span className="inline-flex min-w-0 items-center gap-1.5 rounded-xl bg-white/80 px-2.5 py-1.5 text-xs font-bold text-slate-500 shadow-soft ring-1 ring-slate-200/80 sm:text-sm">
              <BotIcon size={16} className="text-brand-500" />
              <span className="hidden sm:inline">Chơi với Bot ·</span>
              <span className="font-display text-brand-600">{BOT_LEVEL[room.bot?.difficulty ?? 'medium']}</span>
            </span>
          ) : tlink ? (
            <TournamentMatchBar link={tlink} roomId={room.id} />
          ) : (
          <button
            type="button"
            onClick={copyInvite}
            className="group inline-flex min-w-0 items-center gap-1.5 rounded-xl bg-white/80 px-2.5 py-1.5 text-xs font-bold text-slate-500 shadow-soft ring-1 ring-slate-200/80 transition-all hover:-translate-y-0.5 hover:text-brand-600 sm:text-sm"
            title="Sao chép link mời"
          >
            <span className="hidden sm:inline">Phòng</span>
            <span className="font-display tracking-wider text-brand-600">{room.id}</span>
            <CopyIcon size={14} className="opacity-50 group-hover:opacity-100" />
          </button>
          )}
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2">
          <span className="tabular hidden rounded-xl bg-white/80 px-2 py-1.5 text-xs font-bold text-slate-500 ring-1 ring-slate-200/80 sm:inline-flex" title="Kích thước bàn · thời gian mỗi lượt">
            {size}×{size} · {Math.round(room.config.turnMs / 1000)}s
          </span>
          {room.spectatorCount > 0 && (
            <span className="hidden items-center gap-1 rounded-xl bg-violet-50 px-2 py-1.5 text-xs font-bold text-violet-600 ring-1 ring-violet-200 sm:inline-flex" title="Người xem">
              <EyeIcon size={14} /> {room.spectatorCount}
            </span>
          )}
          {isPlayer && room.spectatorCount > 0 && (
            <IconButton
              label={hypeOn ? 'Ẩn tương tác của khán giả' : 'Hiện tương tác của khán giả'}
              aria-pressed={hypeOn}
              active={hypeOn}
              onClick={() => setHypeOn(!hypeOn)}
            >
              <SparkIcon size={18} className={cx(!hypeOn && 'opacity-40')} />
            </IconButton>
          )}
          <span
            className={cx('h-2.5 w-2.5 rounded-full', connected ? 'bg-emerald-400' : 'animate-pulse bg-orange-400')}
            title={connected ? 'Đã kết nối' : 'Đang kết nối lại…'}
          />
          <AccountMenu compact />
          <IconButton label="Luật chơi" onClick={() => setRulesOpen(true)}>
            <BookIcon size={18} />
          </IconButton>
          <IconButton label={soundOn ? 'Tắt âm thanh' : 'Bật âm thanh'} onClick={() => setSoundOn(!soundOn)} active={soundOn}>
            {soundOn ? <VolumeOnIcon size={18} /> : <VolumeOffIcon size={18} />}
          </IconButton>
          <Button
            variant="secondary"
            size="sm"
            className="h-10"
            icon={<LogOutIcon size={17} />}
            onClick={() => (isPlayer && playing ? setConfirm('leave') : void doLeave())}
          >
            <span className="hidden sm:inline">{tlink && !(isPlayer && playing) ? 'Về bracket' : 'Rời phòng'}</span>
          </Button>
        </div>
      </header>

      <main
        className={cx(
          'mx-auto grid min-h-0 w-full max-w-[1760px] flex-1 gap-2.5 overflow-y-auto px-3 pb-3 sm:gap-4 sm:px-5',
          'grid-cols-2 grid-rows-[auto_minmax(300px,1fr)]',
          'lg:grid-cols-[minmax(220px,280px)_minmax(0,1fr)_minmax(220px,280px)] lg:grid-rows-[minmax(0,1fr)] lg:gap-6 lg:overflow-hidden lg:pb-5',
        )}
      >
        <aside className={asideClass('col-start-1')}>
          {cardFor('X')}
          {desktopComms && (
            <>
              {voicePanel}
              <ReactionPanel reactions={reactions} canTalk={comms.canTalk} className="min-h-[124px] flex-1" />
            </>
          )}
          {desktopStands && <ReactionPanel reactions={standsReactions} canTalk={stands.canPost} className="min-h-[124px] flex-1" />}
        </aside>

        <section className="relative col-span-2 col-start-1 row-start-2 flex min-h-0 min-w-0 flex-col gap-2.5 lg:col-span-1 lg:col-start-2 lg:row-start-1 lg:gap-3">
          {/* Desktop: actions share the status row so the board gets the height. */}
          <div className="flex flex-col items-center gap-2 lg:flex-row lg:flex-wrap lg:justify-center lg:gap-3">
            <GameStatus tone={status.tone} text={status.text} mark={status.mark} spectating={!isPlayer} />
            <div className="hidden flex-wrap items-center justify-center gap-2 lg:flex">
              {controls}
              {standsButton}
            </div>
          </div>
          {showCheerBar && (
            <CheerBar
              className="mx-auto -my-0.5"
              seats={seats}
              cheers={stands.cheers}
              supports={isSpectator ? stands.supports : undefined}
              onCheer={isSpectator ? stands.cheer : undefined}
              disabled={!stands.canPost || stands.cheerCoolingDown}
            />
          )}
          <GameBoard
            className="flex-1"
            board={game?.board ?? '.'.repeat(size * size)}
            size={size}
            winLine={game?.winLine ?? null}
            lastMove={game?.lastMove?.index ?? null}
            ghostMark={canMove ? myMark : null}
            pendingIndex={pending}
            onCellClick={onCellClick}
            followIndex={follow}
            overlay={overlay}
          />
          <div className="flex flex-wrap items-center justify-center gap-2 lg:hidden">
            {controls}
            {mobileComms}
            {standsButton}
          </div>
          <HypeLayer items={isSpectator || hypeOn ? stands.hype : []} sideOf={sideOf} />
          {isPlayer && hypeOn && <CommentTicker items={stands.ticker} />}
        </section>

        <aside className={asideClass('col-start-2 lg:col-start-3')}>
          {cardFor('O')}
          {desktopComms && (
            <ChatPanel
              chat={chat}
              myId={me.playerId}
              opponentName={opponent?.name ?? null}
              canTalk={comms.canTalk}
              avatarOf={liveAvatarOf}
              nameStyleOf={liveNameStyleOf}
              avatarFrameOf={liveAvatarFrameOf}
              className="min-h-[220px] flex-1"
            />
          )}
          {desktopStands && <StandsPanel stands={stands} viewers={room.spectatorCount} className="min-h-[220px] flex-1" />}
        </aside>
      </main>

      {showComms && (
        <CommsDrawer open={commsOpen && !isDesktop} onClose={() => setCommsOpen(false)}>
          {voicePanel}
          <ChatPanel
            chat={chat}
            myId={me.playerId}
            opponentName={opponent?.name ?? null}
            canTalk={comms.canTalk}
            avatarOf={liveAvatarOf}
              nameStyleOf={liveNameStyleOf}
              avatarFrameOf={liveAvatarFrameOf}
            className="flex-1"
            footer={<ReactionPicker variant="row" onPick={reactions.send} coolingDown={reactions.coolingDown} disabled={!comms.canTalk} />}
          />
        </CommsDrawer>
      )}

      {(isSpectator || playerStandsAvailable) && (
        <CommsDrawer title="Khán đài" open={standsOpen && (isPlayer || !isDesktop)} onClose={() => setStandsOpen(false)}>
          <StandsPanel stands={stands} viewers={room.spectatorCount} readOnly={isPlayer} withReactions={isSpectator} className="flex-1" />
        </CommsDrawer>
      )}

      {result && (
        <ResultModal
          open={modalOpen}
          result={result}
          roomId={room.id}
          myPlayerId={me.playerId}
          players={room.players}
          rematchVotes={room.rematchVotes}
          onRematch={onRematch}
          onClose={() => setModalOpen(false)}
          onLeave={doLeave}
          tournament={tournamentOutcome}
        />
      )}

      <RulesModal open={rulesOpen} onClose={() => setRulesOpen(false)} config={room.config} live={playing} mode={vsBot ? 'bot' : 'pvp'} />

      <ConfirmDialog
        open={confirm === 'resign'}
        title="Đầu hàng ván này?"
        message="Đối thủ sẽ được xử thắng."
        confirmLabel="Đầu hàng"
        onConfirm={doResign}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === 'leave'}
        title="Rời khỏi phòng?"
        message={
          tlink
            ? 'Đây là trận đấu giải — rời phòng lúc này sẽ bị xử thua và bị loại khỏi giải.'
            : 'Ván đấu vẫn đang diễn ra — rời phòng lúc này sẽ bị tính là thua.'
        }
        confirmLabel="Rời phòng"
        onConfirm={doLeave}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}

const BOT_LEVEL: Record<BotDifficulty, string> = { easy: 'Dễ', medium: 'Trung bình', hard: 'Khó' };

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-[1760px] items-center px-3 py-3 sm:px-5">
        <Logo />
      </header>
      <main className="flex flex-1 items-center justify-center p-4">{children}</main>
    </div>
  );
}

function PhaseScreen({
  phase,
  roomId,
  error,
  onRetry,
  onReclaim,
}: {
  phase: string;
  roomId: string;
  error: string | null;
  onRetry: () => void;
  onReclaim: () => void;
}) {
  if (phase === 'connecting') {
    return (
      <Card className="animate-fade-up flex w-full max-w-sm flex-col items-center p-8 text-center">
        <Spinner className="h-8 w-8 border-[3px] text-brand-500" />
        <h1 className="mt-4 font-display text-xl font-bold text-slate-800">Đang vào phòng {roomId}</h1>
        <p className="mt-1 text-sm text-slate-500">Đang kết nối tới máy chủ…</p>
      </Card>
    );
  }

  const screens: Record<string, { title: string; text: string; action?: ReactNode }> = {
    'not-found': {
      title: 'Không tìm thấy phòng',
      text: 'Phòng này không tồn tại hoặc đã hết hạn. Hãy xin bạn của bạn link mới, hoặc tự tạo phòng.',
    },
    replaced: {
      title: 'Đang mở ở tab khác',
      text: 'Ván đấu này đang được mở ở một tab hoặc cửa sổ khác.',
      action: (
        <Button variant="primary" onClick={onReclaim}>
          Chơi ở tab này
        </Button>
      ),
    },
    closed: { title: 'Phòng đã đóng', text: 'Mọi người đã rời phòng nên phòng đã được đóng.' },
    error: {
      title: 'Lỗi kết nối',
      text: error ?? 'Không thể kết nối tới máy chủ trò chơi.',
      action: (
        <Button variant="primary" onClick={onRetry}>
          Thử lại
        </Button>
      ),
    },
  };
  const s = screens[phase] ?? screens.error;
  return (
    <Card className="animate-fade-up w-full max-w-sm p-8 text-center">
      <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-3xl bg-brand-50 font-display text-3xl font-bold text-brand-400">?</div>
      <h1 className="font-display text-2xl font-bold text-slate-800">{s.title}</h1>
      <p className="mt-2 text-sm text-slate-500">{s.text}</p>
      <div className="mt-6 flex flex-col gap-2">
        {s.action}
        <Link
          to="/"
          className="inline-flex h-11 items-center justify-center rounded-2xl bg-white font-display font-semibold text-slate-700 shadow-soft ring-1 ring-slate-200 transition-all hover:-translate-y-0.5 hover:text-brand-600"
        >
          Về sảnh
        </Link>
      </div>
    </Card>
  );
}
