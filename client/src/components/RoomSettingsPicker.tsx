import { cx } from '../lib/cx';
import { BOARD_SIZES, TURN_SECONDS, type BoardSize, type TurnSeconds } from '../lib/protocol';

interface Option<T> {
  value: T;
  label: string;
  hint: string;
}

const BOARD_OPTIONS: Option<BoardSize>[] = BOARD_SIZES.map((n) => ({
  value: n,
  label: `${n}×${n}`,
  hint: { 15: 'Ván nhanh', 20: 'Tiêu chuẩn', 30: 'Bàn rộng' }[n],
}));

const TURN_OPTIONS: Option<TurnSeconds>[] = TURN_SECONDS.map((n) => ({
  value: n,
  label: `${n} giây`,
  hint: { 15: 'Siêu tốc', 30: 'Tiêu chuẩn', 60: 'Thong thả' }[n],
}));

interface PickerProps<T> {
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

export function BoardSizePicker(props: PickerProps<BoardSize>) {
  return <Segmented legend="Kích thước bàn" options={BOARD_OPTIONS} {...props} />;
}

export function TurnTimePicker(props: PickerProps<TurnSeconds>) {
  return <Segmented legend="Thời gian mỗi lượt" options={TURN_OPTIONS} {...props} />;
}

/** Segmented control for one setting of a new room. */
function Segmented<T extends number>({ legend, options, value, onChange, className }: PickerProps<T> & { legend: string; options: Option<T>[] }) {
  return (
    <fieldset className={className}>
      <legend className="text-xs font-bold tracking-wide text-slate-400 uppercase">{legend}</legend>
      <div className="mt-1.5 grid grid-cols-3 gap-1 rounded-2xl bg-slate-100 p-1">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={value === o.value}
            onClick={() => onChange(o.value)}
            className={cx(
              'rounded-xl px-1 py-1.5 transition-all',
              'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-200',
              value === o.value ? 'bg-white text-brand-600 shadow-soft' : 'text-slate-500 hover:text-slate-700',
            )}
          >
            <div className="tabular font-display text-sm font-bold whitespace-nowrap">{o.label}</div>
            <div className={cx('text-[11px] leading-tight font-semibold', value === o.value ? 'text-brand-400' : 'text-slate-400')}>
              {o.hint}
            </div>
          </button>
        ))}
      </div>
    </fieldset>
  );
}
