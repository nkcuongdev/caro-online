import { useEffect } from 'react';
import { celebrate } from '../../lib/confetti';
import { cx } from '../../lib/cx';
import type { PublicParticipant, TournamentSnapshot } from '../../lib/protocol';
import { sfx } from '../../lib/sound';
import { participantMap, reachedRound, roundName } from '../../lib/tournament';
import { AvatarWithFrame } from '../AvatarWithFrame';
import { PlayerName } from '../PlayerName';
import { CloseIcon, HomeIcon, PlusIcon } from '../icons';
import { Modal } from '../Modal';
import { Button } from '../ui';
import { Crown, Trophy } from './parts';

interface ChampionModalProps {
  open: boolean;
  t: TournamentSnapshot;
  myId: string | null;
  onClose: () => void;
  onHome: () => void;
  onNew: () => void;
}

export function ChampionModal({ open, t, myId, onClose, onHome, onNew }: ChampionModalProps) {
  const players = participantMap(t);
  const champion = t.championId ? players.get(t.championId) : undefined;
  const final = t.rounds[t.rounds.length - 1]?.[0];
  const runnerUpId = final && (final.playerA === t.championId ? final.playerB : final.playerA);
  const runnerUp = runnerUpId ? players.get(runnerUpId) : undefined;
  const semis = t.rounds.length >= 2 ? t.rounds[t.rounds.length - 2] : [];
  const thirds = semis
    .map((m) => (m.winnerId === m.playerA ? m.playerB : m.playerA))
    .filter((id): id is string => !!id && id !== runnerUpId)
    .map((id) => players.get(id))
    .filter((p): p is PublicParticipant => !!p);

  useEffect(() => {
    if (!open) return;
    sfx.fanfare();
    celebrate();
    const timers = [900, 2000].map((ms) => window.setTimeout(celebrate, ms));
    return () => timers.forEach(window.clearTimeout);
  }, [open]);

  if (!champion) return null;
  const iWon = champion.id === myId;
  const myReach = myId && !iWon ? reachedRound(t, myId) : -1;
  const note = iWon
    ? 'Bạn đã thắng tất cả các trận. Quá đỉnh!'
    : myId === runnerUpId
      ? 'Á quân — chỉ còn cách ngôi vương một trận!'
      : myReach >= 0
        ? `Bạn đã dừng bước ở ${roundName(myReach, t.rounds.length).toLowerCase()}.`
        : `Chúc mừng nhà vô địch của ${t.name}!`;

  return (
    <Modal open={open} onClose={onClose} labelledBy="champion-title" className="max-w-md overflow-hidden p-0! text-center">
      <button
        type="button"
        onClick={onClose}
        className="absolute top-3 right-3 z-20 rounded-xl bg-white/25 p-1.5 text-white transition-colors hover:bg-white/40"
        aria-label="Đóng và xem bracket"
      >
        <CloseIcon size={18} />
      </button>

      <div className="t-hero-dots relative overflow-hidden bg-gradient-to-br from-amber-300 via-orange-400 to-rose-400 px-6 pt-8 pb-20">
        <div className="t-rays absolute top-1/2 left-1/2 h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full" aria-hidden="true" />
        <Trophy className="t-rise t-bob relative mx-auto h-20 w-20 drop-shadow-[0_10px_18px_rgb(146_64_14/0.45)]" />
        <p className="relative mt-2 text-xs font-extrabold tracking-[0.2em] text-white/90 uppercase">{t.name}</p>
        <h2 id="champion-title" className="relative font-display text-3xl font-bold text-white drop-shadow-sm sm:text-4xl">
          {iWon ? 'Bạn là Nhà vô địch!' : 'Nhà vô địch!'}
        </h2>
      </div>

      <div className="relative -mt-14 flex flex-col items-center px-6">
        <div className="t-rise relative" style={{ animationDelay: '200ms' }}>
          <Crown className="absolute -top-7 left-1/2 z-10 h-10 w-10 -translate-x-1/2 t-bob" />
          <AvatarWithFrame
            avatar={champion.avatar}
            frameId={champion.avatarFrame}
            seed={champion.id}
            name={champion.name}
            className="h-28 w-28 rounded-[32px] bg-amber-50 shadow-[0_18px_40px_-14px_rgb(245_158_11/0.9)] ring-[6px] ring-white"
          />
        </div>
        <PlayerName as="div" name={champion.name} nameStyle={champion.nameStyle} className="mt-3 max-w-full truncate font-display text-2xl font-bold text-slate-800" />
        <p className="mt-1 text-sm font-semibold text-slate-500">{note}</p>

        {(runnerUp || thirds.length > 0) && (
          <div className="mt-5 flex w-full items-end justify-center gap-3">
            {runnerUp && <Podium p={runnerUp} place={2} />}
            {thirds.map((p) => (
              <Podium key={p.id} p={p} place={3} />
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-2 px-6 pt-5 pb-6">
        <Button variant="primary" size="lg" onClick={onClose} data-autofocus>
          Xem bracket
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" icon={<PlusIcon size={18} />} onClick={onNew}>
            Giải mới
          </Button>
          <Button variant="ghost" icon={<HomeIcon size={18} />} onClick={onHome}>
            Về sảnh
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function Podium({ p, place }: { p: PublicParticipant; place: 2 | 3 }) {
  return (
    <div className="flex w-24 min-w-0 flex-col items-center">
      <AvatarWithFrame
        avatar={p.avatar}
        frameId={p.avatarFrame}
        seed={p.id}
        name={p.name}
        className={cx('h-12 w-12 rounded-2xl ring-[3px]', place === 2 ? 'bg-slate-50 ring-slate-300' : 'bg-orange-50 ring-orange-300')}
      />
      <PlayerName name={p.name} nameStyle={p.nameStyle} className="mt-1 max-w-full truncate text-xs font-bold text-slate-600" />
      <span
        className={cx(
          'mt-1 w-full rounded-t-xl pt-1 font-display text-sm font-bold',
          place === 2 ? 'h-10 bg-gradient-to-b from-slate-200 to-slate-100 text-slate-500' : 'h-7 bg-gradient-to-b from-orange-200 to-orange-100 text-orange-700',
        )}
      >
        {place === 2 ? 'Á quân' : 'Hạng 3'}
      </span>
    </div>
  );
}
