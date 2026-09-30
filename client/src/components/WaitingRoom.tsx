import { useState } from 'react';
import { cx } from '../lib/cx';
import type { PublicPlayer } from '../lib/protocol';
import { AvatarWithFrame } from './AvatarWithFrame';
import { PlayerName } from './PlayerName';
import { CheckIcon } from './icons';
import { InvitePanel } from './InvitePanel';
import { OPiece, XPiece } from './Pieces';
import { TitleBadge } from './titles/TitleBadge';
import { Button, LoadingDots } from './ui';

/** Overlay card shown on the board while the host waits for Player 2. */
export function WaitingRoom({
  roomId,
  boardSize,
  turnMs,
  title = 'Đang chờ đối thủ',
  subtitle,
}: {
  roomId: string;
  boardSize?: number;
  turnMs?: number;
  title?: string;
  subtitle?: string;
}) {
  return (
    <div className="animate-fade-up w-full max-w-md rounded-[28px] bg-white/95 p-6 text-center shadow-lift ring-1 ring-slate-200/70 backdrop-blur sm:p-8">
      <div className="relative mx-auto mb-5 h-20 w-32" aria-hidden="true">
        <div className="absolute top-2 left-2 grid h-14 w-14 animate-float place-items-center rounded-2xl bg-coral-50 ring-1 ring-coral-100">
          <XPiece className="h-10 w-10" />
        </div>
        <div
          className="absolute top-4 right-2 grid h-14 w-14 animate-float place-items-center rounded-2xl bg-brand-50 ring-1 ring-brand-100"
          style={{ animationDelay: '-1.6s' }}
        >
          <OPiece className="h-10 w-10" />
        </div>
      </div>
      <h2 className="font-display text-2xl font-bold text-slate-800">
        {title}
        <LoadingDots className="ml-1.5 text-brand-400" />
      </h2>
      <p className="mx-auto mt-2 max-w-xs text-sm text-slate-500">
        {subtitle ?? 'Gửi link này cho bạn bè. Khi họ vào phòng, cả hai bấm “Sẵn sàng” để bắt đầu.'}
      </p>
      <div className="mt-2 inline-flex items-center gap-2 rounded-full bg-slate-50 px-3 py-1 text-xs font-bold text-slate-500 ring-1 ring-slate-200">
        Mã phòng <span className="font-display text-sm tracking-wider text-brand-600">{roomId}</span>
      </div>
      {boardSize && (
        <p className="tabular mt-1.5 text-xs font-semibold text-slate-400">
          Bàn {boardSize}×{boardSize}
          {turnMs && <> · {Math.round(turnMs / 1000)} giây mỗi lượt</>}
        </p>
      )}
      <InvitePanel roomId={roomId} className="mt-5" />
    </div>
  );
}

/** Shown when both seats are taken but one player is offline before the match starts. */
export function WaitingForReturn({ name, nameStyle }: { name: string; nameStyle?: string }) {
  return (
    <div className="animate-fade-up w-full max-w-sm rounded-[28px] bg-white/95 p-6 text-center shadow-lift ring-1 ring-slate-200/70">
      <h2 className="font-display text-xl font-bold text-slate-800">
        Đang chờ <PlayerName name={name} nameStyle={nameStyle} />
        <LoadingDots className="ml-1.5 text-brand-400" />
      </h2>
      <p className="mt-2 text-sm text-slate-500">Người chơi này đang mất kết nối. Khi họ quay lại, cả hai bấm “Sẵn sàng” để bắt đầu.</p>
    </div>
  );
}

/**
 * Pre-match ready check, shown on the board once both seats are filled and
 * online. The match only starts after both players confirm. Spectators see
 * who is ready but get no button.
 */
export function ReadyCheck({
  players,
  readyVotes,
  myId,
  onReady,
}: {
  players: PublicPlayer[];
  readyVotes: string[];
  myId: string | null;
  onReady: (ready: boolean) => Promise<{ ok: boolean; message?: string }>;
}) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Your own seat on the left.
  const [left, right] = [...players].sort((a, b) => Number(b.id === myId) - Number(a.id === myId));
  const isPlayer = players.some((p) => p.id === myId);
  const iReady = !!myId && readyVotes.includes(myId);
  const opponent = players.find((p) => p.id !== myId) ?? null;
  const theyReady = !!opponent && readyVotes.includes(opponent.id);

  const send = async (value: boolean) => {
    setSending(true);
    setError(null);
    const res = await onReady(value);
    setSending(false);
    if (!res.ok) setError(res.message ?? 'Không gửi được, hãy thử lại.');
  };

  return (
    <div className="animate-fade-up w-full max-w-md rounded-[28px] bg-white/95 p-6 text-center shadow-lift ring-1 ring-slate-200/70 backdrop-blur sm:p-8">
      <h2 className="font-display text-2xl font-bold text-slate-800">{isPlayer ? 'Sẵn sàng chưa?' : 'Chờ hai bên sẵn sàng'}</h2>
      <p className="mx-auto mt-1 max-w-xs text-sm text-slate-500">
        {isPlayer ? 'Trận đấu bắt đầu khi cả hai người chơi bấm “Sẵn sàng”.' : 'Trận đấu bắt đầu khi cả hai người chơi xác nhận.'}
      </p>

      <div className="mt-5 grid grid-cols-[1fr_auto_1fr] items-start gap-2">
        <ReadySeat player={left} ready={readyVotes.includes(left.id)} you={left.id === myId} />
        <div className="mt-5 grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-coral-400 to-rose-500 font-display text-sm font-extrabold text-white shadow-soft">
          VS
        </div>
        <ReadySeat player={right} ready={readyVotes.includes(right.id)} you={right.id === myId} />
      </div>

      {isPlayer && (
        <div className="mt-6">
          {iReady ? (
            <div className="flex flex-col items-center gap-2">
              <div className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-50 font-display font-bold text-emerald-700 ring-1 ring-emerald-200">
                <CheckIcon size={18} />
                {theyReady ? 'Cả hai đã sẵn sàng!' : 'Đã sẵn sàng · chờ đối thủ'}
                {!theyReady && <LoadingDots className="text-emerald-500" />}
              </div>
              <Button variant="ghost" size="sm" disabled={sending} onClick={() => send(false)}>
                Hủy sẵn sàng
              </Button>
            </div>
          ) : (
            <Button
              variant="success"
              size="lg"
              className={cx('w-full tracking-wide', !sending && theyReady && 'animate-pulse-soft')}
              loading={sending}
              icon={!sending && <CheckIcon size={20} />}
              onClick={() => send(true)}
            >
              SẴN SÀNG!
            </Button>
          )}
          {error && <p className="mt-2 text-sm font-semibold text-red-500">{error}</p>}
        </div>
      )}
    </div>
  );
}

function ReadySeat({ player, ready, you }: { player: PublicPlayer; ready: boolean; you: boolean }) {
  return (
    <div className="flex min-w-0 flex-col items-center">
      <div className="relative">
        <AvatarWithFrame
          avatar={player.avatar}
          frameId={player.avatarFrame}
          seed={player.id}
          name={player.name}
          className={cx('h-16 w-16 rounded-2xl ring-4 transition-[box-shadow,--tw-ring-color] duration-300', ready ? 'ring-emerald-400' : 'ring-slate-100')}
        />
        {ready && (
          <span className="absolute -right-2 -bottom-2 grid h-7 w-7 animate-pop-in place-items-center rounded-full bg-emerald-500 text-white shadow-md ring-[3px] ring-white">
            <CheckIcon size={14} strokeWidth={3} />
          </span>
        )}
      </div>
      <span className="mt-2 flex max-w-full items-baseline font-display text-sm font-bold text-slate-800">
        <PlayerName name={player.name} nameStyle={player.nameStyle} className="truncate" />
        {you && <span className="shrink-0 text-slate-400">&nbsp;(bạn)</span>}
      </span>
      {player.title && <TitleBadge title={player.title} size="sm" className="mb-0.5" />}
      <span className={cx('text-xs font-bold', ready ? 'text-emerald-600' : 'text-slate-400')}>{ready ? 'Sẵn sàng!' : 'Chưa sẵn sàng'}</span>
    </div>
  );
}
