import { useState } from 'react';
import { cx } from '../lib/cx';
import type { BotDifficulty, BotFirstMove, BotSettings } from '../lib/protocol';
import { getSavedBotSettings } from '../lib/session';
import { BotIcon } from './icons';
import { Modal } from './Modal';
import { Button } from './ui';

const DIFFICULTIES: { value: BotDifficulty; label: string; hint: string; tone: string }[] = [
  { value: 'easy', label: 'Dễ', hint: 'Đánh khá ngẫu nhiên', tone: 'text-emerald-600' },
  { value: 'medium', label: 'Trung bình', hint: 'Biết tấn công và chặn', tone: 'text-orange-500' },
  { value: 'hard', label: 'Khó', hint: 'Tính trước nhiều nước', tone: 'text-coral-500' },
];

const FIRST_MOVES: { value: BotFirstMove; label: string }[] = [
  { value: 'human', label: 'Bạn' },
  { value: 'bot', label: 'Bot' },
  { value: 'random', label: 'Ngẫu nhiên' },
];

interface BotSetupModalProps {
  open: boolean;
  loading: boolean;
  /** Picked in the lobby; shown here as a reminder. */
  boardSize: number;
  turnSeconds: number;
  onStart: (settings: BotSettings) => void;
  onClose: () => void;
}

export function BotSetupModal({ open, loading, boardSize, turnSeconds, onStart, onClose }: BotSetupModalProps) {
  const [settings, setSettings] = useState(getSavedBotSettings);

  return (
    <Modal open={open} onClose={onClose} labelledBy="bot-title" className="max-w-md">
      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-2xl bg-brand-50 text-brand-500">
          <BotIcon size={24} />
        </span>
        <div>
          <h2 id="bot-title" className="font-display text-xl font-bold text-slate-800">
            Chơi với Bot
          </h2>
          <p className="text-sm text-slate-500">
            Luyện tập một mình, không tính xếp hạng.{' '}
            <span className="font-semibold whitespace-nowrap text-slate-600">
              Bàn {boardSize}×{boardSize} · {turnSeconds} giây/lượt
            </span>
          </p>
        </div>
      </div>

      <fieldset className="mt-5">
        <legend className="text-xs font-bold tracking-wide text-slate-400 uppercase">Độ khó</legend>
        <div className="mt-1.5 grid grid-cols-3 gap-2">
          {DIFFICULTIES.map((d) => (
            <button
              key={d.value}
              type="button"
              aria-pressed={settings.difficulty === d.value}
              onClick={() => setSettings((s) => ({ ...s, difficulty: d.value }))}
              data-autofocus={settings.difficulty === d.value || undefined}
              className={cx(
                'rounded-2xl p-3 text-center ring-1 transition-all hover:-translate-y-0.5',
                'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-200',
                settings.difficulty === d.value ? 'bg-brand-50 ring-2 ring-brand-400' : 'bg-slate-50 ring-slate-200 hover:ring-brand-200',
              )}
            >
              <div className={cx('font-display text-base font-bold', d.tone)}>{d.label}</div>
              <div className="mt-0.5 text-[11px] leading-tight font-semibold text-slate-500">{d.hint}</div>
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="mt-4">
        <legend className="text-xs font-bold tracking-wide text-slate-400 uppercase">Đi trước</legend>
        <div className="mt-1.5 grid grid-cols-3 gap-1 rounded-2xl bg-slate-100 p-1">
          {FIRST_MOVES.map((f) => (
            <button
              key={f.value}
              type="button"
              aria-pressed={settings.firstMove === f.value}
              onClick={() => setSettings((s) => ({ ...s, firstMove: f.value }))}
              className={cx(
                'h-10 rounded-xl font-display text-sm font-semibold transition-all',
                'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-200',
                settings.firstMove === f.value ? 'bg-white text-brand-600 shadow-soft' : 'text-slate-500 hover:text-slate-700',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="mt-6 grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={onClose}>
          Hủy
        </Button>
        <Button variant="primary" loading={loading} icon={!loading && <BotIcon size={18} />} onClick={() => onStart(settings)}>
          Bắt đầu
        </Button>
      </div>
    </Modal>
  );
}
