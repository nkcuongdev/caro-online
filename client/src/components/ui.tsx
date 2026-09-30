import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link } from 'react-router';
import { cx } from '../lib/cx';

type Variant = 'primary' | 'secondary' | 'soft' | 'ghost' | 'danger' | 'success';
type Size = 'sm' | 'md' | 'lg';

const variants: Record<Variant, string> = {
  primary:
    'text-white bg-gradient-to-b from-brand-400 to-brand-600 shadow-[0_6px_16px_-6px_rgb(37_99_235/0.55)] hover:shadow-[0_10px_22px_-8px_rgb(37_99_235/0.6)] hover:brightness-105',
  success:
    'text-white bg-gradient-to-b from-emerald-400 to-emerald-500 shadow-[0_6px_16px_-6px_rgb(16_185_129/0.55)] hover:brightness-105',
  secondary: 'bg-white text-slate-700 ring-1 ring-slate-200 shadow-soft hover:ring-brand-200 hover:text-brand-600',
  soft: 'bg-brand-50 text-brand-600 hover:bg-brand-100',
  ghost: 'text-slate-500 hover:bg-slate-100 hover:text-slate-700',
  danger: 'bg-white text-red-500 ring-1 ring-red-100 shadow-soft hover:bg-red-50 hover:ring-red-200',
};

const sizes: Record<Size, string> = {
  sm: 'h-9 px-3 text-sm gap-1.5 rounded-xl',
  md: 'h-11 px-4 text-[15px] gap-2 rounded-2xl',
  lg: 'h-14 px-6 text-lg gap-2.5 rounded-2xl',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, loading, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cx(
        'inline-flex select-none items-center justify-center font-display font-semibold whitespace-nowrap',
        'transition-all duration-150 ease-out hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.97]',
        'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-200',
        'disabled:pointer-events-none disabled:opacity-50',
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  );
});

export function IconButton({
  label,
  className,
  children,
  active,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white text-slate-500 shadow-soft ring-1 ring-slate-200/80',
        'transition-all duration-150 hover:-translate-y-0.5 hover:text-brand-600 hover:ring-brand-200 active:scale-95',
        'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-200',
        active && 'text-brand-600',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cx('inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent', className)}
      aria-hidden="true"
    />
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cx('rounded-3xl bg-white/90 shadow-soft ring-1 ring-slate-200/70 backdrop-blur', className)}>
      {children}
    </div>
  );
}

export function LoadingDots({ className }: { className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1', className)} aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 animate-bounce-dot rounded-full bg-current"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </span>
  );
}

export function Logo({ compact, responsive }: { compact?: boolean; responsive?: boolean }) {
  return (
    <Link to="/" className="group inline-flex items-center gap-2.5 rounded-xl focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-200">
      <span className="grid h-9 w-9 grid-cols-2 gap-0.5 rounded-xl bg-gradient-to-br from-brand-400 to-brand-600 p-1.5 shadow-[0_6px_14px_-6px_rgb(37_99_235/0.6)] transition-transform duration-300 group-hover:rotate-6">
        <span className="rounded-[4px] bg-coral-300" />
        <span className="rounded-full border-2 border-white/90" />
        <span className="rounded-full border-2 border-white/90" />
        <span className="rounded-[4px] bg-emerald-200" />
      </span>
      {!compact && (
        <span className={cx('font-display text-xl font-bold tracking-tight text-slate-800', responsive && 'hidden sm:inline')}>
          Caro<span className="text-brand-500">Online</span>
        </span>
      )}
    </Link>
  );
}
