import type { InputHTMLAttributes } from 'react';
import { cx } from '../lib/cx';
import { randomName } from '../lib/names';
import { DiceIcon } from './icons';

interface NameInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'className'> {
  value: string;
  onChange: (name: string) => void;
  className?: string;
  /** Allows `data-autofocus` (picked up by Modal). */
  'data-autofocus'?: boolean;
}

/** Player-name field with a dice button that fills in a random name. */
export function NameInput({ value, onChange, className, ...inputProps }: NameInputProps) {
  return (
    <div className={cx('relative min-w-0 flex-1', className)}>
      <input
        value={value}
        maxLength={20}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="nickname"
        {...inputProps}
        className="h-12 w-full rounded-2xl bg-slate-50 pr-12 pl-4 font-semibold text-slate-700 ring-1 ring-slate-200 outline-none transition-shadow placeholder:font-normal placeholder:text-slate-400 focus:bg-white focus:ring-4 focus:ring-brand-100"
      />
      <button
        type="button"
        onClick={() => onChange(randomName(value.trim()))}
        aria-label="Tên ngẫu nhiên"
        className="group absolute top-1/2 right-1.5 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-xl text-slate-400 transition-colors hover:bg-brand-50 hover:text-brand-600 focus-visible:ring-4 focus-visible:ring-brand-100 focus-visible:outline-none active:scale-95"
      >
        <DiceIcon size={20} className="transition-transform duration-300 group-hover:rotate-12" />
        {/* Right-aligned so it stays inside the card at the input's right edge. */}
        <span
          role="tooltip"
          className="pointer-events-none absolute right-0 bottom-full mb-2 translate-y-1 rounded-lg bg-slate-800 px-2.5 py-1.5 text-xs font-semibold whitespace-nowrap text-white opacity-0 shadow-lift transition-all duration-150 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100"
        >
          Tên ngẫu nhiên
          <span className="absolute top-full right-3.5 -mt-1 h-2 w-2 rotate-45 bg-slate-800" />
        </span>
      </button>
    </div>
  );
}
