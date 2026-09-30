import type { ReactNode } from 'react';
import { cx } from '../lib/cx';
import { BookIcon, CheckIcon, CloseIcon } from './icons';
import { Modal } from './Modal';
import { OPiece, XPiece } from './Pieces';
import { Button } from './ui';

export interface RulesConfig {
  boardSize?: number;
  /** Omitted in the lobby, where the host hasn't picked one yet. */
  turnMs?: number;
  startCountdownMs: number;
  disconnectForfeitMs: number;
}

/** Server defaults, shown in the lobby where there is no room config yet. */
const DEFAULTS: RulesConfig = { startCountdownMs: 3_000, disconnectForfeitMs: 60_000 };

interface RulesModalProps {
  open: boolean;
  onClose: () => void;
  /** The room's actual settings; the defaults are shown when omitted. */
  config?: RulesConfig;
  /** A game is running: remind the player the clock keeps ticking while they read. */
  live?: boolean;
  /** The room's mode; both rematch rules are listed when omitted. */
  mode?: 'pvp' | 'bot';
}

export function RulesModal({ open, onClose, config = DEFAULTS, live, mode }: RulesModalProps) {
  const seconds = (ms: number) => Math.round(ms / 1000);
  const board = config.boardSize ? `${config.boardSize}×${config.boardSize}` : 'từ 15×15 đến 30×30';

  return (
    <Modal open={open} onClose={onClose} labelledBy="rules-title" className="flex max-h-[calc(100dvh-2rem)] max-w-lg flex-col p-0!">
      <div className="flex items-center gap-3 px-6 pt-6">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brand-50 text-brand-500">
          <BookIcon size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="rules-title" className="font-display text-xl font-bold text-slate-800">
            Luật chơi Caro
          </h2>
          <p className="text-sm text-slate-500">Bàn {board} · X luôn đi trước</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Đóng"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-200"
        >
          <CloseIcon size={18} />
        </button>
      </div>

      {live && (
        <p className="mx-6 mt-4 rounded-2xl bg-orange-50 px-3 py-2 text-xs font-semibold text-orange-600 ring-1 ring-orange-100">
          Ván đấu vẫn đang diễn ra — đồng hồ không dừng khi bạn xem luật.
        </p>
      )}

      <div className="board-scroll min-h-0 flex-1 overflow-y-auto px-6 pt-4 pb-2 text-sm text-slate-600">
        <Section title="Cách thắng">
          <p>
            Xếp <b>đúng 5 quân</b> liên tiếp của mình theo hàng ngang, hàng dọc hoặc đường chéo.
          </p>
          <Example row="·XXXXX·" win={[1, 2, 3, 4, 5]} ok caption="5 quân, hai đầu trống — thắng" />
          <Example row="OXXXXX·" win={[1, 2, 3, 4, 5]} ok caption="Bị chặn một đầu — vẫn thắng" />
          <Example row="|XXXXXO" win={[1, 2, 3, 4, 5]} ok caption="Sát mép bàn — mép bàn không tính là chặn" />
        </Section>

        <Section title="Không tính thắng">
          <Example row="OXXXXXO" win={[1, 2, 3, 4, 5]} caption="Bị quân đối phương chặn kín cả hai đầu" />
          <Example row="·XXXXXX·" win={[1, 2, 3, 4, 5, 6]} caption="6 quân trở lên liên tiếp" />
          <p className="text-xs text-slate-500">
            Trong hai trường hợp này ván đấu vẫn tiếp tục. Nếu cùng nước đi đó tạo ra 5 quân hợp lệ ở một hướng khác thì vẫn thắng.
          </p>
        </Section>

        <Section title="Lượt đi & thời gian">
          <ul className="list-disc space-y-1 pl-5">
            {mode !== 'bot' && <li>Khi đủ hai người, cả hai bấm <b>Sẵn sàng</b> thì trận đấu mới bắt đầu.</li>}
            <li>Ván bắt đầu sau {seconds(config.startCountdownMs)} giây đếm ngược. Hai bên lần lượt đặt một quân vào ô trống.</li>
            <li>
              {config.turnMs ? (
                <>
                  Mỗi lượt có <b>{seconds(config.turnMs)} giây</b>.
                </>
              ) : (
                <>
                  Mỗi lượt có <b>15, 30 hoặc 60 giây</b>, do người tạo phòng chọn.
                </>
              )}{' '}
              Hết giờ mà chưa đi thì <b>thua</b>.
            </li>
            {mode !== 'bot' && <li>Khi chơi lại với người, hai bên đổi quân cho nhau.</li>}
            {mode !== 'pvp' && <li>Khi chơi với bot, ai đi trước theo lựa chọn lúc tạo ván, kể cả khi chơi lại.</li>}
          </ul>
        </Section>

        <Section title="Thua & hòa">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Bạn <b>thua</b> nếu đối thủ thắng, bạn hết giờ, đầu hàng, rời phòng khi đang đánh, hoặc mất kết nối quá{' '}
              {seconds(config.disconnectForfeitMs)} giây.
            </li>
            <li>
              Ván <b>hòa</b> khi bàn cờ kín hết ô mà chưa ai thắng.
            </li>
          </ul>
        </Section>
      </div>

      <div className="px-6 pt-2 pb-6">
        <Button variant="primary" className="w-full" onClick={onClose} data-autofocus>
          Đã hiểu
        </Button>
      </div>
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-5 space-y-2">
      <h3 className="text-xs font-bold tracking-wide text-slate-400 uppercase">{title}</h3>
      {children}
    </section>
  );
}

/**
 * One line of cells: `X`/`O` pieces, `·` empty, `|` the board edge.
 * `win` marks the indices of the counted line.
 */
function Example({ row, win = [], ok = false, caption }: { row: string; win?: number[]; ok?: boolean; caption: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <div className="flex shrink-0 items-center" aria-hidden="true">
        {[...row].map((ch, i) =>
          ch === '|' ? (
            <span key={i} className="mr-0.5 h-7 w-1.5 rounded-full bg-slate-400" />
          ) : (
            <span
              key={i}
              className={cx(
                'grid h-7 w-7 place-items-center border border-slate-200 first:rounded-l-lg last:rounded-r-lg',
                i > 0 && '-ml-px',
                win.includes(i) ? (ok ? 'bg-emerald-50' : 'bg-red-50') : 'bg-white',
              )}
            >
              {ch === 'X' && <XPiece className="h-6 w-6" />}
              {ch === 'O' && <OPiece className="h-6 w-6" />}
            </span>
          ),
        )}
      </div>
      <span className={cx('inline-flex items-center gap-1 text-xs font-semibold', ok ? 'text-emerald-600' : 'text-red-500')}>
        {ok ? <CheckIcon size={14} /> : <CloseIcon size={14} />}
        {caption}
      </span>
    </div>
  );
}
