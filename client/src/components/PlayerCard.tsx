import { useState, type FormEvent } from 'react';
import type { ShownReaction } from '../hooks/useReactions';
import { defaultAvatarFor, presetAvatar } from '../lib/avatar';
import { useServerNow } from '../lib/clock';
import { cx } from '../lib/cx';
import type { Mark, PublicPlayer } from '../lib/protocol';
import { AvatarWithFrame } from './AvatarWithFrame';
import { AvatarPicker } from './AvatarPicker';
import { PlayerName } from './PlayerName';
import { ReactionBubble } from './comms/ReactionPicker';
import { SpeakingBars } from './comms/VoicePanel';
import { GameTimer } from './GameTimer';
import { CameraIcon, CheckIcon, MicOffIcon, PencilIcon, TrophyIcon, VerifiedIcon } from './icons';
import { MarkBadge, Piece } from './Pieces';
import { TitleBadge } from './titles/TitleBadge';
import { titleSkin } from './titles/titleSkins';
import { Modal } from './Modal';
import { Button, LoadingDots } from './ui';

interface PlayerCardProps {
  seat: Mark;
  player: PublicPlayer | null;
  isYou: boolean;
  isTurn: boolean;
  /** Deadline to display when this player's clock is running. */
  deadline: number | null;
  /** Time left while this player's clock is frozen (they're offline on their turn). */
  pausedMs?: number | null;
  turnMs: number;
  statusText: string | null;
  /** Highlighted note under the card ("Muốn chơi lại!", "Đã sẵn sàng!"). Replaces the status text. */
  callout?: string | null;
  isWinner: boolean;
  onRename?: (name: string) => void;
  /** Only for your own card. Resolve `false` to keep the picker open. */
  onChangeAvatar?: (avatar: string) => boolean | Promise<boolean>;
  /** Emoji currently floating over the avatar. */
  reaction?: ShownReaction | null;
  /** Voice chat indicator; omitted when this player hasn't enabled voice. */
  voice?: PlayerVoice | null;
  className?: string;
}

export interface PlayerVoice {
  muted: boolean;
  speaking: boolean;
}

export function PlayerCard({
  seat,
  player,
  isYou,
  isTurn,
  deadline,
  pausedMs = null,
  turnMs,
  statusText,
  callout = null,
  isWinner,
  onRename,
  onChangeAvatar,
  reaction,
  voice,
  className,
}: PlayerCardProps) {
  if (!player) return <EmptySeat seat={seat} className={className} />;
  const mark = player.mark;
  const tone = mark ?? seat;
  // A title plate needs the card's full width on phones, where the name column is too narrow for its text.
  const titlePlate = !!titleSkin(player.title?.id);

  return (
    <section
      aria-label={`Người chơi ${mark ?? ''} ${player.name}`}
      className={cx(
        'relative animate-fade-up rounded-3xl border-2 p-3 transition-[background-color,border-color,box-shadow] duration-300 sm:p-4 lg:p-5',
        isTurn
          ? 'animate-breathe border-brand-400 bg-brand-50/90'
          : isWinner
            ? 'border-emerald-300 bg-emerald-50/80 shadow-soft'
            : 'border-transparent bg-white/90 shadow-soft',
        className,
      )}
    >
      {isTurn && (
        <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-full bg-brand-500 px-2.5 py-0.5 font-display text-[11px] font-semibold tracking-wide text-white uppercase shadow-sm">
          {isYou ? 'Lượt bạn' : 'Đến lượt'}
        </span>
      )}

      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:gap-4 lg:flex-col lg:items-stretch">
        <div className="flex min-w-0 items-center gap-2.5 sm:flex-1 lg:flex-col lg:gap-3 lg:text-center">
          <Avatar
            player={player}
            mark={tone}
            speaking={!!voice?.speaking}
            reaction={reaction ?? null}
            onChange={isYou ? onChangeAvatar : undefined}
          />
          <div className="min-w-0 flex-1 lg:w-full">
            <NameLine name={player.name} nameStyle={player.nameStyle} isYou={isYou} registered={player.registered} onRename={onRename} />
            {player.title && (
              <div className={cx('mt-0.5 min-w-0 lg:mt-1 lg:justify-center', titlePlate ? 'hidden sm:flex' : 'flex')}>
                <TitleBadge title={player.title} size="sm" />
              </div>
            )}
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs font-semibold text-slate-500 lg:justify-center lg:text-sm">
              <span className="inline-flex items-center gap-1">
                <MarkBadge mark={mark} className="h-4 w-4 text-[10px] lg:h-5 lg:w-5 lg:text-xs" />
                <span className="hidden sm:inline">{mark ? `Người chơi ${mark}` : 'Chờ vào trận'}</span>
              </span>
              <span className="inline-flex items-center gap-1" title={`${player.wins} trận thắng`}>
                <TrophyIcon size={13} className="text-amber-500" />
                {player.wins}
                <span className="hidden sm:inline">thắng</span>
              </span>
              {voice && <VoiceChip voice={voice} />}
            </div>
          </div>
        </div>

        {player.title && titlePlate && (
          <div className="flex min-w-0 justify-center sm:hidden">
            <TitleBadge title={player.title} size="sm" />
          </div>
        )}

        <GameTimer deadline={deadline} pausedMs={pausedMs} turnMs={turnMs} tickSound={isYou} className="sm:w-32 lg:w-full" />
      </div>

      <div className="mt-2 min-h-5 text-center text-xs font-semibold lg:mt-3 lg:text-sm">
        {!player.online ? (
          <OfflineNote forfeitAt={player.forfeitAt} clockPaused={pausedMs !== null} />
        ) : callout ? (
          <span className="text-emerald-600">{callout}</span>
        ) : (
          <span className={cx('inline-flex items-center gap-1.5', isTurn ? 'text-brand-600' : 'text-slate-400')}>
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            {statusText ?? 'Trực tuyến'}
          </span>
        )}
      </div>
    </section>
  );
}

function Avatar({
  player,
  mark,
  speaking,
  reaction,
  onChange,
}: {
  player: PublicPlayer;
  mark: Mark;
  speaking: boolean;
  reaction: ShownReaction | null;
  onChange?: (avatar: string) => boolean | Promise<boolean>;
}) {
  const [picking, setPicking] = useState(false);
  const online = player.online;
  const image = (
    <AvatarWithFrame
      avatar={player.avatar}
      frameId={player.avatarFrame}
      seed={player.id}
      name={player.name}
      className={cx(
        'h-10 w-10 rounded-2xl text-base shadow-sm ring-2 sm:h-12 sm:w-12 sm:text-lg lg:h-20 lg:w-20 lg:rounded-3xl lg:text-2xl lg:ring-[3px]',
        // The seat colour stays visible around any picture.
        mark === 'X' ? 'bg-coral-50 ring-coral-300' : 'bg-brand-50 ring-brand-300',
        !online && 'grayscale-[0.6] opacity-70',
        speaking && 'animate-speaking',
      )}
    />
  );

  return (
    <div className="relative shrink-0 lg:mx-auto">
      {onChange ? (
        <button
          type="button"
          onClick={() => setPicking(true)}
          aria-label="Đổi avatar"
          title="Đổi avatar"
          className="group relative block rounded-2xl focus-visible:ring-4 focus-visible:ring-brand-200 focus-visible:outline-none lg:rounded-3xl"
        >
          {image}
          <span className="absolute inset-0 grid place-items-center rounded-2xl bg-slate-900/35 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 lg:rounded-3xl">
            <CameraIcon size={20} className="lg:h-7 lg:w-7" />
          </span>
          <span className="absolute -bottom-1 -left-1 grid h-5 w-5 place-items-center rounded-full bg-white text-brand-500 shadow-sm ring-1 ring-slate-200 lg:h-7 lg:w-7">
            <CameraIcon size={11} className="lg:h-4 lg:w-4" />
          </span>
        </button>
      ) : (
        image
      )}
      {onChange && (
        <AvatarPicker open={picking} current={player.avatar ?? presetAvatar(defaultAvatarFor(player.id).id)} seed={player.id} onClose={() => setPicking(false)} onSave={onChange} />
      )}
      {reaction && <ReactionBubble key={reaction.id} reaction={reaction} className="-top-5 left-full -ml-4 sm:-ml-3 lg:-top-7 lg:-ml-5" />}
      <span className="absolute -top-1.5 -right-1.5 grid h-5 w-5 place-items-center rounded-full bg-white shadow-sm ring-1 ring-slate-100 lg:h-8 lg:w-8">
        <Piece mark={mark} className="h-4 w-4 lg:h-6 lg:w-6" strokeWidth={6} />
      </span>
      <span
        className={cx(
          'absolute -right-0.5 -bottom-0.5 h-3 w-3 rounded-full ring-2 ring-white lg:h-4 lg:w-4',
          online ? 'bg-emerald-400' : 'bg-slate-300',
        )}
        title={online ? 'Trực tuyến' : 'Ngoại tuyến'}
      />
    </div>
  );
}

function VoiceChip({ voice }: { voice: PlayerVoice }) {
  return (
    <span
      className={cx('inline-flex items-center gap-1 transition-colors', voice.muted ? 'text-slate-400' : voice.speaking ? 'text-emerald-600' : 'text-slate-400')}
      title={voice.muted ? 'Đang tắt mic' : voice.speaking ? 'Đang nói' : 'Đã bật voice'}
    >
      {voice.muted ? <MicOffIcon size={13} /> : <SpeakingBars active={voice.speaking} />}
      <span className="hidden sm:inline">{voice.muted ? 'Tắt mic' : voice.speaking ? 'Đang nói' : 'Voice'}</span>
    </span>
  );
}

function NameLine({
  name,
  nameStyle,
  isYou,
  registered,
  onRename,
}: {
  name: string;
  nameStyle?: string;
  isYou: boolean;
  registered?: boolean;
  onRename?: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <div className="flex min-w-0 items-center gap-1.5 lg:justify-center">
      <PlayerName name={name} nameStyle={nameStyle} className="truncate font-display text-[15px] font-semibold text-slate-800 sm:text-base lg:text-xl" />
      {registered && (
        <span title="Thành viên đã đăng ký" className="-ml-0.5 shrink-0 text-brand-500">
          <VerifiedIcon size={16} />
        </span>
      )}
      {isYou && (
        <span className="shrink-0 rounded-full bg-brand-100 px-1.5 py-0.5 text-[10px] font-bold text-brand-600 uppercase lg:text-[11px]">
          Bạn
        </span>
      )}
      {isYou && onRename && (
        <>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="-m-1 shrink-0 rounded-lg p-1.5 text-slate-400 transition-colors hover:text-brand-500 active:bg-brand-50 sm:m-0 sm:p-0.5 sm:text-slate-300"
            aria-label="Đổi tên"
          >
            <PencilIcon size={13} />
          </button>
          {editing && (
            <RenameDialog
              name={name}
              onSave={(next) => {
                if (next !== name) onRename(next);
                setEditing(false);
              }}
              onCancel={() => setEditing(false)}
            />
          )}
        </>
      )}
    </div>
  );
}

/** A dialog rather than inline editing: the name row is only ~70px wide on phones. */
function RenameDialog({ name, onSave, onCancel }: { name: string; onSave: (name: string) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState(name);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next = draft.trim();
    if (next) onSave(next);
    else onCancel();
  };

  return (
    <Modal open onClose={onCancel} labelledBy="rename-title">
      <h2 id="rename-title" className="font-display text-xl font-bold text-slate-800">
        Đổi tên
      </h2>
      <form onSubmit={submit} className="mt-4">
        <label htmlFor="rename-input" className="block text-xs font-bold tracking-wide text-slate-400 uppercase">
          Tên của bạn
        </label>
        <input
          id="rename-input"
          data-autofocus
          value={draft}
          maxLength={20}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          autoComplete="nickname"
          enterKeyHint="done"
          className="mt-1.5 h-12 w-full rounded-2xl bg-slate-50 px-4 font-semibold text-slate-700 ring-1 ring-slate-200 outline-none transition-shadow focus:bg-white focus:ring-4 focus:ring-brand-100"
        />
        <div className="mt-5 grid grid-cols-2 gap-2">
          <Button type="button" variant="secondary" onClick={onCancel}>
            Hủy
          </Button>
          <Button type="submit" variant="primary" icon={<CheckIcon size={18} />}>
            Lưu tên
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function OfflineNote({ forfeitAt, clockPaused }: { forfeitAt: number | null; clockPaused: boolean }) {
  const now = useServerNow(500, forfeitAt !== null);
  const secs = forfeitAt ? Math.max(0, Math.ceil((forfeitAt - now) / 1000)) : null;
  return (
    <span className="inline-flex items-center gap-1.5 text-orange-600">
      <span className="h-1.5 w-1.5 rounded-full bg-orange-400" />
      Mất kết nối{clockPaused && <> · đồng hồ tạm dừng</>}{secs !== null && <> · xử thua sau {secs}s</>}
    </span>
  );
}

function EmptySeat({ seat, className }: { seat: Mark; className?: string }) {
  return (
    <section
      className={cx(
        'flex flex-col items-center justify-center gap-2 rounded-3xl border-2 border-dashed border-slate-200 bg-white/50 p-3 text-center sm:flex-row sm:p-4 lg:flex-col lg:p-5',
        className,
      )}
      aria-label="Ghế trống"
    >
      <div className="grid h-10 w-10 place-items-center rounded-2xl bg-slate-100 sm:h-12 sm:w-12 lg:h-20 lg:w-20 lg:rounded-3xl">
        <Piece mark={seat} className="h-6 w-6 opacity-30 lg:h-10 lg:w-10" />
      </div>
      <div className="text-sm font-semibold text-slate-400">
        <div className="font-display text-slate-500 lg:text-lg">Đang chờ đối thủ</div>
        <LoadingDots className="mt-1 text-slate-300" />
      </div>
    </section>
  );
}
