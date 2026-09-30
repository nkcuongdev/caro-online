import { useState } from 'react';
import { cx } from '../../lib/cx';
import { BEST_OF, TOURNAMENT_SIZES, winsNeeded, type BestOf, type BoardSize, type TournamentSize, type TurnSeconds } from '../../lib/protocol';
import { bestOfHint, randomTournamentName } from '../../lib/tournament';
import { DiceIcon, UsersIcon } from '../icons';
import { Modal } from '../Modal';
import { BoardSizePicker, TurnTimePicker } from '../RoomSettingsPicker';
import { Button } from '../ui';
import { Trophy } from './parts';

export interface TournamentSettings {
  name: string;
  size: TournamentSize;
  bestOf: BestOf;
  boardSize: BoardSize;
  turnSeconds: TurnSeconds;
}

interface SetupProps {
  open: boolean;
  loading: boolean;
  boardSize: BoardSize;
  turnSeconds: TurnSeconds;
  onStart: (settings: TournamentSettings) => void;
  onClose: () => void;
}

const SIZE_HINT: Record<TournamentSize, { rounds: string; tone: string }> = {
  4: { rounds: 'Bán kết → Chung kết', tone: 'from-sky-400 to-brand-500' },
  8: { rounds: 'Tứ kết → Chung kết', tone: 'from-violet-400 to-brand-500' },
  16: { rounds: 'Vòng 1/8 → Chung kết', tone: 'from-amber-400 to-coral-500' },
};

export function TournamentSetupModal(props: SetupProps) {
  // Mounted only while open, so every opening starts with fresh choices.
  return props.open ? <SetupDialog {...props} /> : null;
}

function SetupDialog({ loading, boardSize: initialBoard, turnSeconds: initialTurn, onStart, onClose }: SetupProps) {
  const [name, setName] = useState(randomTournamentName);
  const [size, setSize] = useState<TournamentSize>(8);
  const [bestOf, setBestOf] = useState<BestOf>(1);
  const [boardSize, setBoardSize] = useState(initialBoard);
  const [turnSeconds, setTurnSeconds] = useState(initialTurn);

  return (
    <Modal open onClose={onClose} labelledBy="tsetup-title" className="flex max-h-[calc(100dvh-2rem)] max-w-md flex-col overflow-hidden p-0!">
      {/* Header and footer stay put; only the settings scroll, so the create button is always in reach. */}
      <div className="t-hero-dots relative shrink-0 bg-gradient-to-br from-violet-500 via-brand-500 to-sky-400 px-6 pt-6 pb-5 text-white [@media(max-height:760px)]:pt-4 [@media(max-height:760px)]:pb-3">
        <Trophy className="t-bob absolute top-3 right-5 h-16 w-16 drop-shadow-[0_8px_14px_rgb(30_27_75/0.35)] [@media(max-height:760px)]:h-12 [@media(max-height:760px)]:w-12" />
        <p className="text-xs font-extrabold tracking-[0.18em] text-white/80 uppercase">Loại trực tiếp</p>
        <h2 id="tsetup-title" className="font-display text-2xl font-bold">
          Tạo giải đấu
        </h2>
        <p className="mt-0.5 max-w-[15rem] text-sm font-semibold text-white/85 [@media(max-height:760px)]:hidden">
          Thắng thì đi tiếp, thua là dừng bước. Ai sẽ lên ngôi?
        </p>
      </div>

      {/* Stable gutter: a scrollbar appearing must not narrow the content (that re-wraps labels and changes the height). */}
      <div className="board-scroll min-h-0 flex-1 space-y-4 overflow-y-auto pt-5 pr-4 pb-5 pl-6 [scrollbar-gutter:stable]">
        <div>
          <label htmlFor="tname" className="block text-xs font-bold tracking-wide text-slate-400 uppercase">
            Tên giải
          </label>
          <div className="relative mt-1.5">
            <input
              id="tname"
              value={name}
              maxLength={40}
              onChange={(e) => setName(e.target.value)}
              className="h-12 w-full rounded-2xl bg-slate-50 pr-12 pl-4 font-display font-semibold text-slate-700 ring-1 ring-slate-200 outline-none transition-shadow focus:bg-white focus:ring-4 focus:ring-brand-100"
            />
            <button
              type="button"
              onClick={() => setName(randomTournamentName())}
              aria-label="Tên ngẫu nhiên"
              title="Tên ngẫu nhiên"
              className="absolute top-1/2 right-1.5 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-xl text-slate-400 transition-colors hover:bg-brand-50 hover:text-brand-600"
            >
              <DiceIcon size={20} />
            </button>
          </div>
        </div>

        <fieldset>
          <legend className="text-xs font-bold tracking-wide text-slate-400 uppercase">Số người chơi</legend>
          <div className="mt-1.5 grid grid-cols-3 gap-2">
            {TOURNAMENT_SIZES.map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={size === n}
                onClick={() => setSize(n)}
                className={cx(
                  'group relative overflow-hidden rounded-2xl p-2.5 text-center transition-all focus-visible:ring-4 focus-visible:ring-brand-200 focus-visible:outline-none',
                  size === n ? 'text-white shadow-lift' : 'bg-slate-50 text-slate-600 ring-1 ring-slate-200 hover:-translate-y-0.5 hover:ring-brand-200',
                )}
              >
                {size === n && <span className={cx('absolute inset-0 bg-gradient-to-br', SIZE_HINT[n].tone)} />}
                <span className="relative flex items-center justify-center gap-1 font-display text-2xl leading-none font-bold">
                  <UsersIcon size={16} className="opacity-70" />
                  {n}
                </span>
                <span className={cx('relative mt-1 block min-h-[2.5em] text-[10px] leading-tight font-bold', size === n ? 'text-white/85' : 'text-slate-400')}>
                  {SIZE_HINT[n].rounds}
                </span>
              </button>
            ))}
          </div>
          <p className="mt-1.5 min-h-8 text-xs leading-4 font-semibold text-slate-400">
            Có thể bắt đầu khi đủ {size / 2 + 1} người — ô trống sẽ thành lượt miễn đấu.
          </p>
        </fieldset>

        <fieldset>
          <legend className="text-xs font-bold tracking-wide text-slate-400 uppercase">Thể thức mỗi trận</legend>
          <div className="mt-1.5 grid grid-cols-3 gap-2">
            {BEST_OF.map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={bestOf === n}
                onClick={() => setBestOf(n)}
                className={cx(
                  'rounded-2xl px-1.5 py-2 text-center transition-all focus-visible:ring-4 focus-visible:ring-brand-200 focus-visible:outline-none',
                  bestOf === n ? 'bg-white text-brand-600 shadow-soft ring-2 ring-brand-400' : 'bg-slate-50 text-slate-600 ring-1 ring-slate-200 hover:-translate-y-0.5 hover:ring-brand-200',
                )}
              >
                <span className="block font-display text-lg leading-none font-bold">BO{n}</span>
                <span className="mt-1.5 flex justify-center gap-1" aria-hidden="true">
                  {Array.from({ length: n }, (_, i) => (
                    <span
                      key={i}
                      className={cx(
                        'h-2 w-2 rounded-full transition-colors',
                        bestOf === n ? (i < winsNeeded(n) ? 'bg-brand-500' : 'bg-brand-200') : 'bg-slate-300',
                      )}
                    />
                  ))}
                </span>
                <span className={cx('mt-1 block min-h-[2.5em] text-[10px] leading-tight font-bold', bestOf === n ? 'text-brand-400' : 'text-slate-400')}>
                  {bestOfHint(n)}
                </span>
              </button>
            ))}
          </div>
          {/* Room for two lines whatever the format, so switching formats never changes the dialog's height. */}
          <p className="mt-1.5 min-h-8 text-xs leading-4 font-semibold text-slate-400">
            {bestOf > 1 ? 'Các ván đánh liên tiếp trong cùng phòng, đổi quân sau mỗi ván.' : 'Mỗi trận một ván, thắng là đi tiếp.'}
          </p>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2 sm:gap-3">
          <BoardSizePicker value={boardSize} onChange={setBoardSize} />
          <TurnTimePicker value={turnSeconds} onChange={setTurnSeconds} />
        </div>
      </div>

      <div className="shrink-0 border-t border-slate-100 bg-white px-6 pt-3 pb-5 shadow-[0_-10px_20px_-16px_rgb(15_23_42/0.35)]">
        <Button
          variant="primary"
          size="lg"
          className="w-full"
          loading={loading}
          icon={<Trophy className="h-6 w-6" />}
          onClick={() => onStart({ name: name.trim(), size, bestOf, boardSize, turnSeconds })}
        >
          Mở sảnh giải đấu
        </Button>
      </div>
    </Modal>
  );
}
