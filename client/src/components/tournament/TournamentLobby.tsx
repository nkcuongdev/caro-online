import { useState, type FormEvent, type ReactNode } from 'react';
import { defaultAvatarFor, presetAvatar } from '../../lib/avatar';
import { cx } from '../../lib/cx';
import { tournamentLink } from '../../lib/env';
import type { PublicParticipant, TournamentSnapshot } from '../../lib/protocol';
import { getSavedName } from '../../lib/session';
import { AvatarWithFrame } from '../AvatarWithFrame';
import { PlayerName } from '../PlayerName';
import { AvatarPicker, MyAvatarButton } from '../AvatarPicker';
import { CameraIcon, CloseIcon, PlusIcon, SparkIcon, TrophyIcon, UsersIcon, ZapIcon } from '../icons';
import { bestOfHint } from '../../lib/tournament';
import { InvitePanel } from '../InvitePanel';
import { NameInput } from '../NameInput';
import { Button, Card, LoadingDots } from '../ui';
import { TitleBadge } from '../titles/TitleBadge';
import { Crown } from './parts';

interface LobbyProps {
  t: TournamentSnapshot;
  myId: string | null;
  onJoin: (name: string) => Promise<void>;
  onStart: () => Promise<void>;
  onKick: (participantId: string) => void;
  onChangeAvatar: (avatar: string) => Promise<boolean>;
}

/** Pre-start screen: who's in, the invite, and the host's start button. */
export function TournamentLobby({ t, myId, onJoin, onStart, onKick, onChangeAvatar }: LobbyProps) {
  const [starting, setStarting] = useState(false);
  const isHost = !!myId && t.hostId === myId;
  const isIn = !!myId && t.participants.some((p) => p.id === myId);
  const count = t.participants.length;
  const missing = Math.max(0, t.minPlayers - count);
  const byes = t.size - count;
  const seats = Array.from({ length: t.size }, (_, i) => t.participants[i] ?? null);

  const start = async () => {
    setStarting(true);
    await onStart();
    setStarting(false);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-6">
      <Card className="order-2 p-4 sm:p-5 lg:order-1">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 font-display text-xl font-bold text-slate-800">
              <UsersIcon size={20} className="text-brand-500" /> Người chơi
            </h2>
            <p className="text-sm font-semibold text-slate-400">
              {count < t.size ? `Còn ${t.size - count} chỗ trống` : 'Đã đủ người!'}
            </p>
          </div>
          <div className="w-full sm:w-64">
            <div className="flex justify-between text-xs font-bold text-slate-500">
              <span className="tabular">
                {count}/{t.size}
              </span>
              <span className={missing ? 'text-amber-600' : 'text-emerald-600'}>{missing ? `Cần thêm ${missing}` : 'Có thể bắt đầu'}</span>
            </div>
            <div className="relative mt-1 h-2.5 overflow-hidden rounded-full bg-slate-100">
              <div
                className={cx('h-full rounded-full transition-[width] duration-500', missing ? 'bg-gradient-to-r from-amber-300 to-amber-400' : 'bg-gradient-to-r from-emerald-400 to-brand-400')}
                style={{ width: `${(count / t.size) * 100}%` }}
              />
              <span className="absolute top-0 h-full w-0.5 bg-slate-400/60" style={{ left: `${(t.minPlayers / t.size) * 100}%` }} title="Số người tối thiểu" />
            </div>
          </div>
        </div>

        <ul className={cx('mt-4 grid gap-2.5 sm:gap-3', t.size === 4 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-2 sm:grid-cols-4')}>
          {seats.map((p, i) =>
            p ? (
              <SeatCard key={p.id} p={p} isMe={p.id === myId} canKick={isHost && p.id !== myId} onKick={() => onKick(p.id)} onChangeAvatar={onChangeAvatar} />
            ) : (
              <EmptySeat key={`empty-${i}`} n={i + 1} />
            ),
          )}
        </ul>
      </Card>

      <div className="order-1 flex flex-col gap-4 lg:order-2">
        {!isIn && <JoinCard t={t} onJoin={onJoin} />}

        {isIn && (
          <Card className="p-5">
            {isHost ? (
              <>
                <div className="flex items-center gap-2 font-display text-lg font-bold text-slate-800">
                  <Crown className="h-6 w-6" /> Bạn là chủ giải
                </div>
                <p className="mt-1 text-sm text-slate-500">
                  {missing
                    ? `Cần ít nhất ${t.minPlayers} người để bắt đầu. Gửi link cho bạn bè nhé!`
                    : byes > 0
                      ? `${byes} ô trống sẽ thành lượt miễn đấu cho hạt giống cao.`
                      : 'Bracket đã đủ, sẵn sàng khai cuộc!'}
                </p>
                <Button
                  variant="primary"
                  size="lg"
                  className={cx('mt-4 w-full', !missing && 'animate-breathe')}
                  disabled={!!missing}
                  loading={starting}
                  icon={<ZapIcon size={20} />}
                  onClick={start}
                >
                  Bắt đầu giải đấu
                </Button>
              </>
            ) : (
              <div className="text-center">
                <div className="font-display text-lg font-bold text-slate-800">
                  Đang chờ chủ giải bắt đầu
                  <LoadingDots className="ml-1.5 text-brand-400" />
                </div>
                <p className="mt-1 text-sm text-slate-500">Bracket sẽ được bốc thăm ngẫu nhiên khi giải khởi tranh.</p>
              </div>
            )}
          </Card>
        )}

        <Card className="p-5">
          <InvitePanel roomId={t.id} link={tournamentLink(t.id)} shareText={`Vào đấu giải "${t.name}" với mình nhé!`} />
          <p className="mt-3 text-center text-xs font-semibold text-slate-400">
            Hoặc nhập mã <span className="font-display text-sm tracking-wider text-brand-600">{t.id}</span> ở sảnh chính
          </p>
        </Card>

        <Card className="p-4">
          <ul className="space-y-2 text-sm font-semibold text-slate-500">
            <Rule icon={<SparkIcon size={15} />}>Loại trực tiếp — thắng đi tiếp, thua dừng bước.</Rule>
            <Rule icon={<TrophyIcon size={15} />}>
              Mỗi trận BO{t.config.bestOf}: {bestOfHint(t.config.bestOf).toLowerCase()}
              {t.config.bestOf > 1 && ', đổi quân sau mỗi ván'}.
            </Rule>
            <Rule icon={<ZapIcon size={15} />}>Trước mỗi trận, cả hai bấm “Sẵn sàng” trong {Math.round(t.config.readyCheckMs / 1000)} giây.</Rule>
            <Rule icon={<UsersIcon size={15} />}>Ai không đang đấu có thể xem trực tiếp các trận khác.</Rule>
          </ul>
        </Card>
      </div>
    </div>
  );
}

function Rule({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-500">{icon}</span>
      <span>{children}</span>
    </li>
  );
}

function SeatCard({
  p,
  isMe,
  canKick,
  onKick,
  onChangeAvatar,
}: {
  p: PublicParticipant;
  isMe: boolean;
  canKick: boolean;
  onKick: () => void;
  onChangeAvatar: (avatar: string) => Promise<boolean>;
}) {
  const [picking, setPicking] = useState(false);
  const face = (
    <AvatarWithFrame
      avatar={p.avatar}
      frameId={p.avatarFrame}
      seed={p.id}
      name={p.name}
      className={cx('h-16 w-16 rounded-2xl bg-brand-50 shadow-sm ring-[3px] sm:h-[72px] sm:w-[72px]', isMe ? 'ring-brand-300' : p.isHost ? 'ring-amber-300' : 'ring-white', !p.online && 'opacity-60 grayscale-[0.5]')}
    />
  );
  return (
    <li
      className={cx(
        'group relative flex animate-pop-in flex-col items-center rounded-2xl px-2 pt-4 pb-3 text-center transition-transform hover:-translate-y-0.5',
        isMe ? 'bg-gradient-to-b from-brand-50 to-white ring-2 ring-brand-300' : 'bg-gradient-to-b from-slate-50 to-white ring-1 ring-slate-200/80',
      )}
    >
      {canKick && (
        <button
          type="button"
          onClick={onKick}
          aria-label={`Mời ${p.name} ra khỏi giải`}
          title="Mời ra"
          className="absolute top-1.5 right-1.5 grid h-6 w-6 place-items-center rounded-lg text-slate-300 opacity-100 transition-all hover:bg-red-50 hover:text-red-500 sm:opacity-0 sm:group-hover:opacity-100"
        >
          <CloseIcon size={14} />
        </button>
      )}
      <div className="relative">
        {p.isHost && <Crown className="absolute -top-4 left-1/2 z-10 h-6 w-6 -translate-x-1/2 rotate-[-8deg]" />}
        {isMe ? (
          <button type="button" onClick={() => setPicking(true)} className="group/av relative block rounded-2xl" aria-label="Đổi avatar" title="Đổi avatar">
            {face}
            <span className="absolute inset-0 grid place-items-center rounded-2xl bg-slate-900/35 text-white opacity-0 transition-opacity group-hover/av:opacity-100">
              <CameraIcon size={20} />
            </span>
          </button>
        ) : (
          face
        )}
        <span className={cx('absolute -right-1 -bottom-1 h-3.5 w-3.5 rounded-full ring-2 ring-white', p.online ? 'bg-emerald-400' : 'bg-slate-300')} />
      </div>
      <div className="mt-2 flex max-w-full items-center gap-1">
        <PlayerName name={p.name} nameStyle={p.nameStyle} className="truncate font-display text-sm font-bold text-slate-700 sm:text-base" />
      </div>
      {p.title && <TitleBadge title={p.title} size="sm" className="mt-0.5" />}
      <span className={cx('mt-0.5 rounded-full px-2 text-[10px] font-extrabold tracking-wide uppercase', isMe ? 'bg-brand-100 text-brand-600' : p.isHost ? 'bg-amber-100 text-amber-700' : 'text-slate-300')}>
        {isMe ? 'Bạn' : p.isHost ? 'Chủ giải' : p.online ? 'Sẵn sàng' : 'Ngoại tuyến'}
      </span>
      {isMe && (
        <AvatarPicker
          open={picking}
          current={p.avatar ?? presetAvatar(defaultAvatarFor(p.id).id)}
          seed={p.id}
          onClose={() => setPicking(false)}
          onSave={onChangeAvatar}
        />
      )}
    </li>
  );
}

function EmptySeat({ n }: { n: number }) {
  return (
    <li className="t-seat-wait flex flex-col items-center justify-center rounded-2xl border-2 border-dashed px-2 pt-4 pb-3 text-center">
      <span className="grid h-16 w-16 place-items-center rounded-2xl bg-slate-50 text-slate-300 sm:h-[72px] sm:w-[72px]">
        <PlusIcon size={22} />
      </span>
      <span className="mt-2 font-display text-sm font-bold text-slate-300">Ghế #{n}</span>
      <LoadingDots className="mt-0.5 text-slate-200" />
    </li>
  );
}

function JoinCard({ t, onJoin }: { t: TournamentSnapshot; onJoin: (name: string) => Promise<void> }) {
  const [name, setName] = useState(getSavedName);
  const [joining, setJoining] = useState(false);
  const full = t.participants.length >= t.size;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setJoining(true);
    await onJoin(name);
    setJoining(false);
  };

  if (full) {
    return (
      <Card className="p-5 text-center">
        <div className="font-display text-lg font-bold text-slate-800">Giải đã đủ người</div>
        <p className="mt-1 text-sm text-slate-500">Bạn vẫn có thể ở lại xem bracket và các trận đấu trực tiếp.</p>
      </Card>
    );
  }

  return (
    <Card className="relative overflow-hidden p-5 ring-2 ring-brand-200">
      <div className="absolute -top-10 -right-10 h-32 w-32 rounded-full bg-brand-100/70 blur-2xl" aria-hidden="true" />
      <h2 className="relative font-display text-xl font-bold text-slate-800">Tham gia giải đấu</h2>
      <p className="relative text-sm text-slate-500">Chọn avatar, đặt tên và giữ một chỗ trong bracket.</p>
      <form onSubmit={submit} className="relative mt-3 flex items-center gap-3">
        <MyAvatarButton seed="me" className="h-12 w-12" />
        <NameInput value={name} onChange={setName} placeholder="Tên của bạn" aria-label="Tên của bạn" />
      </form>
      <Button variant="primary" size="lg" className="relative mt-3 w-full" loading={joining} icon={<PlusIcon size={20} />} onClick={submit}>
        Vào giải
      </Button>
    </Card>
  );
}
