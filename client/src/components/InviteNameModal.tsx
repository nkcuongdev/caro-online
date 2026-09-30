import { useState, type FormEvent } from 'react';
import { randomName } from '../lib/names';
import { AvatarWithFrame } from './AvatarWithFrame';
import { PlayerName } from './PlayerName';
import { MyAvatarButton } from './AvatarPicker';
import { ArrowRightIcon } from './icons';
import { Modal } from './Modal';
import { NameInput } from './NameInput';
import { OPiece, XPiece } from './Pieces';
import { Button } from './ui';

interface InviteNameModalProps {
  roomId: string;
  hostName: string | null;
  hostNameStyle?: string | null;
  hostAvatar: string | null;
  hostAvatarFrame?: string | null;
  /** Null when the room lookup didn't say (older server, API unreachable). */
  boardSize: number | null;
  turnMs: number | null;
  /** The guest option passes a random name, saved like a typed one so it stays the same in later rooms. */
  onJoin: (name: string) => void;
}

/** Asked once, before an invited first-time visitor takes their seat. */
export function InviteNameModal({ roomId, hostName, hostNameStyle, hostAvatar, hostAvatarFrame, boardSize, turnMs, onJoin }: InviteNameModalProps) {
  const [name, setName] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onJoin(name.trim() || randomName());
  };

  return (
    <Modal open labelledBy="invite-title" className="max-w-md text-center">
      <div className="relative mx-auto mb-4 h-16 w-28" aria-hidden="true">
        <div className="absolute top-0 left-1 grid h-12 w-12 animate-float place-items-center rounded-2xl bg-coral-50 ring-1 ring-coral-100">
          <XPiece className="h-8 w-8" />
        </div>
        <div
          className="absolute top-3 right-1 grid h-12 w-12 animate-float place-items-center rounded-2xl bg-brand-50 ring-1 ring-brand-100"
          style={{ animationDelay: '-1.6s' }}
        >
          <OPiece className="h-8 w-8" />
        </div>
      </div>

      <h2 id="invite-title" className="font-display text-2xl font-bold text-slate-800">
        Bạn được mời chơi Cờ Caro!
      </h2>
      <p className="mt-1.5 text-sm text-slate-500">
        {hostName ? (
          <>
            <AvatarWithFrame
              avatar={hostAvatar}
              frameId={hostAvatarFrame}
              animated={false}
              seed={hostName}
              name={hostName}
              className="mr-1 inline-block h-6 w-6 translate-y-1.5 rounded-lg bg-slate-100 text-[10px] ring-1 ring-slate-200"
            />
            <PlayerName name={hostName} nameStyle={hostNameStyle} className="font-bold text-slate-700" /> đang chờ bạn trong phòng{' '}
            <span className="font-display font-bold tracking-wider text-brand-600">{roomId}</span>.
          </>
        ) : (
          <>
            Phòng <span className="font-display font-bold tracking-wider text-brand-600">{roomId}</span> đang chờ bạn.
          </>
        )}
      </p>
      {boardSize && (
        <p className="mt-2 inline-flex items-center rounded-full bg-slate-50 px-3 py-1 text-xs font-bold text-slate-500 ring-1 ring-slate-200">
          Bàn {boardSize}×{boardSize}
          {turnMs && <> · {Math.round(turnMs / 1000)} giây/lượt</>} · 5 quân liên tiếp
        </p>
      )}

      <form onSubmit={submit} className="mt-5 text-left">
        <label htmlFor="invite-name" className="block text-xs font-bold tracking-wide text-slate-400 uppercase">
          Tên & avatar của bạn
        </label>
        <div className="mt-1.5 flex items-center gap-3">
          <MyAvatarButton seed="me" className="h-12 w-12" />
          <NameInput id="invite-name" data-autofocus value={name} onChange={setName} placeholder="VD: Mèo Lanh Lợi" enterKeyHint="go" />
        </div>
        <Button type="submit" variant="primary" size="lg" className="mt-4 w-full" icon={<ArrowRightIcon size={20} />}>
          Vào chơi
        </Button>
      </form>

      <button
        type="button"
        onClick={() => onJoin(randomName())}
        className="mt-3 text-sm font-semibold text-slate-400 transition-colors hover:text-brand-600"
      >
        Chơi với tư cách khách (tên ngẫu nhiên)
      </button>
    </Modal>
  );
}
