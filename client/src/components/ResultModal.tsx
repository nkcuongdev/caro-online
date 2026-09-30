import { Link } from 'react-router';
import { useAuth } from '../lib/account';
import { cx } from '../lib/cx';
import { resultLine } from '../lib/game';
import type { FinishedResult, Mark, PublicPlayer } from '../lib/protocol';
import { SignUpNudge } from './auth/AuthModal';
import { AvatarWithFrame } from './AvatarWithFrame';
import { PlayerName } from './PlayerName';
import { CheckIcon, CloseIcon, HandshakeIcon, HomeIcon, RematchIcon, TrophyIcon } from './icons';
import { useCopyInvite } from './InvitePanel';
import { Modal } from './Modal';
import { Piece } from './Pieces';
import { TitleBadge } from './titles/TitleBadge';
import type { PublicTitle } from '../lib/titles';
import { Button } from './ui';

interface ResultModalProps {
  open: boolean;
  result: FinishedResult;
  roomId: string;
  myPlayerId: string | null;
  /** Live players (for up-to-date scores and whether the opponent is still here). */
  players: PublicPlayer[];
  rematchVotes: string[];
  onRematch: (accept: boolean) => void;
  onClose: () => void;
  onLeave: () => void;
  /** Tournament match: no rematch, the bracket decides what's next. */
  tournament?: TournamentOutcome;
}

export interface TournamentOutcome {
  /** e.g. "Bạn vào Chung kết!" or "Bạn dừng bước ở Bán kết". */
  headline: string;
  detail: string;
  tone: 'win' | 'lose' | 'neutral';
  onBracket: () => void;
}

export function ResultModal({ open, result, roomId, myPlayerId, players, rematchVotes, onRematch, onClose, onLeave, tournament }: ResultModalProps) {
  const { copy } = useCopyInvite(roomId);
  const { user } = useAuth();
  const me = result.players.find((p) => p.id === myPlayerId) ?? null;
  const myMark = me?.mark ?? null;
  const isPlayer = me !== null;
  const won = !!result.winner && myMark === result.winner;
  const lost = !!result.winner && !!myMark && myMark !== result.winner;
  const draw = !result.winner;

  const opponent = players.find((p) => p.id !== myPlayerId) ?? null;
  const opponentPresent = isPlayer && players.length === 2 && !!opponent;
  const iWant = !!myPlayerId && rematchVotes.includes(myPlayerId);
  const theyWant = !!opponent && rematchVotes.includes(opponent.id);

  const nameOf = (mark: Mark) =>
    players.find((p) => p.mark === mark)?.name ?? result.players.find((p) => p.mark === mark)?.name ?? `Người chơi ${mark}`;
  /** Live avatar first (it may have changed since the game ended), then the one at the end of the game. */
  const faceOf = (mark: Mark) => {
    const p = players.find((x) => x.mark === mark) ?? result.players.find((x) => x.mark === mark);
    return { seed: p?.id ?? mark, avatar: p?.avatar ?? null, avatarFrame: p?.avatarFrame ?? null };
  };
  const nameStyleOf = (mark: Mark) =>
    (players.find((p) => p.mark === mark) ?? result.players.find((p) => p.mark === mark))?.nameStyle ?? null;
  const titleOf = (mark: Mark) =>
    (players.find((p) => p.mark === mark) ?? result.players.find((p) => p.mark === mark))?.title ?? null;
  const winsOf = (mark: Mark) =>
    players.find((p) => p.mark === mark)?.wins ?? result.players.find((p) => p.mark === mark)?.wins ?? 0;

  const title = draw ? 'Hòa!' : won ? 'Bạn thắng!' : lost ? 'Bạn thua rồi' : `${nameOf(result.winner!)} chiến thắng!`;

  return (
    <Modal open={open} onClose={onClose} labelledBy="result-title" className="max-w-md text-center">
      <button
        type="button"
        onClick={onClose}
        className="absolute top-4 right-4 rounded-xl p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
        aria-label="Đóng và xem bàn cờ"
      >
        <CloseIcon size={18} />
      </button>

      <div
        className={cx(
          'mx-auto grid h-20 w-20 place-items-center rounded-[26px]',
          won && 'bg-gradient-to-br from-amber-200 to-amber-400 text-white shadow-[0_12px_28px_-10px_rgb(245_158_11/0.7)]',
          lost && 'bg-slate-100 text-slate-400',
          draw && 'bg-violet-100 text-violet-500',
          !isPlayer && !draw && 'bg-emerald-100 text-emerald-600',
        )}
      >
        {draw ? <HandshakeIcon size={40} /> : result.winner && (won || !isPlayer) ? <TrophyIcon size={40} /> : <Piece mark={result.winner!} className="h-12 w-12" />}
      </div>

      <h2 id="result-title" className="mt-4 font-display text-3xl font-bold text-slate-800">
        {title}
      </h2>
      <p className="mt-1.5 text-sm font-semibold text-slate-500">{resultLine(result)}</p>

      <div className="mt-5 grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-100">
        <ScoreSide mark="X" name={nameOf('X')} nameStyle={nameStyleOf('X')} title={titleOf('X')} face={faceOf('X')} wins={winsOf('X')} highlight={result.winner === 'X'} />
        <span className="font-display text-lg font-bold text-slate-300">:</span>
        <ScoreSide mark="O" name={nameOf('O')} nameStyle={nameStyleOf('O')} title={titleOf('O')} face={faceOf('O')} wins={winsOf('O')} highlight={result.winner === 'O'} />
      </div>

      {tournament && (
        <div
          className={cx(
            'mt-5 rounded-2xl p-3 ring-1',
            tournament.tone === 'win' && 'bg-gradient-to-r from-amber-50 to-orange-50 ring-amber-200',
            tournament.tone === 'lose' && 'bg-slate-50 ring-slate-200',
            tournament.tone === 'neutral' && 'bg-brand-50 ring-brand-100',
          )}
        >
          <p className={cx('font-display text-lg font-bold', tournament.tone === 'win' ? 'text-amber-700' : 'text-slate-700')}>{tournament.headline}</p>
          <p className="text-sm font-semibold text-slate-500">{tournament.detail}</p>
          <Button variant="primary" size="lg" className="mt-3 w-full" icon={<TrophyIcon size={20} />} onClick={tournament.onBracket} data-autofocus>
            Về bracket
          </Button>
        </div>
      )}

      {isPlayer && !tournament && (
        <div className="mt-5 space-y-2">
          {!opponentPresent ? (
            <>
              <p className="text-sm text-slate-500">Đối thủ đã rời phòng. Mời người khác để tiếp tục chơi tại đây.</p>
              <Button variant="primary" className="w-full" onClick={copy}>
                Sao chép link mời
              </Button>
            </>
          ) : iWant ? (
            <>
              <Button variant="soft" className="w-full" onClick={() => onRematch(false)}>
                Đang chờ <PlayerName name={opponent!.name} nameStyle={opponent!.nameStyle} className="max-w-40 truncate" />… (hủy)
              </Button>
            </>
          ) : (
            <>
              {theyWant && (
                <p className="animate-fade-up text-sm font-semibold text-emerald-600">
                  <PlayerName name={opponent!.name} nameStyle={opponent!.nameStyle} /> muốn chơi lại!
                </p>
              )}
              <Button
                variant={theyWant ? 'success' : 'primary'}
                size="lg"
                className={cx('w-full', theyWant && 'animate-pulse-soft')}
                icon={<RematchIcon size={20} />}
                onClick={() => onRematch(true)}
                data-autofocus
              >
                {theyWant ? 'Đồng ý chơi lại' : 'Chơi lại'}
              </Button>
            </>
          )}
        </div>
      )}

      {isPlayer &&
        (user ? (
          <Link
            to="/me#history"
            target="_blank"
            rel="noopener"
            className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700 ring-1 ring-emerald-100 hover:bg-emerald-100"
          >
            <CheckIcon size={13} /> Đã lưu vào lịch sử của bạn
          </Link>
        ) : (
          <SignUpNudge className="mt-3">Đăng ký để lưu ván này vào lịch sử và thống kê.</SignUpNudge>
        ))}

      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={onClose}>
          Xem bàn cờ
        </Button>
        <Button variant="ghost" onClick={onLeave} icon={<HomeIcon size={18} />}>
          Rời phòng
        </Button>
      </div>
    </Modal>
  );
}

function ScoreSide({
  mark,
  name,
  nameStyle,
  title,
  face,
  wins,
  highlight,
}: {
  mark: Mark;
  name: string;
  nameStyle: string | null;
  title: PublicTitle | null;
  face: { seed: string; avatar: string | null; avatarFrame: string | null };
  wins: number;
  highlight: boolean;
}) {
  return (
    <div className={cx('flex min-w-0 flex-col items-center gap-1', mark === 'O' && 'order-last')}>
      <AvatarWithFrame
        avatar={face.avatar}
        frameId={face.avatarFrame}
        seed={face.seed}
        name={name}
        className={cx(
          'mb-0.5 h-12 w-12 rounded-2xl text-lg ring-2',
          mark === 'X' ? 'bg-coral-50' : 'bg-brand-50',
          highlight ? 'ring-amber-300' : mark === 'X' ? 'ring-coral-200' : 'ring-brand-200',
        )}
      />
      <div className="flex items-center gap-1.5">
        <Piece mark={mark} className="h-5 w-5" strokeWidth={6} />
        <span className={cx('tabular font-display text-2xl font-bold', highlight ? 'text-slate-800' : 'text-slate-400')}>{wins}</span>
      </div>
      <PlayerName name={name} nameStyle={nameStyle} className="max-w-full truncate text-xs font-semibold text-slate-500" />
      {title && <TitleBadge title={title} size="sm" />}
    </div>
  );
}
