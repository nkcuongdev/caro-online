import { useId, useState, type FormEvent, type InputHTMLAttributes, type ReactNode } from 'react';
import {
  applyAccountProfile,
  closeAuthModal,
  guestNickname,
  keepGuestProfile,
  login,
  openAuthModal,
  register,
  useAuthModal,
  type AuthModalMode,
  type ProfileChoice,
} from '../../lib/account';
import { getMyAvatar } from '../../lib/avatar';
import { cx } from '../../lib/cx';
import { randomName } from '../../lib/names';
import { getSavedName } from '../../lib/session';
import { AvatarImage } from '../Avatar';
import { AvatarPicker } from '../AvatarPicker';
import { CameraIcon, ChartIcon, CheckIcon, CloseIcon, DiceIcon, EyeIcon, EyeOffIcon, HistoryIcon, LockIcon, MailIcon, SparkIcon } from '../icons';
import { Modal } from '../Modal';
import { OPiece, XPiece } from '../Pieces';
import { useToast } from '../Toasts';
import { Button } from '../ui';

const PASSWORD_MIN = 8;

/** Mounted once in App; any screen opens it with `openAuthModal()`. */
export function AuthModalHost() {
  const mode = useAuthModal();
  // Keyed by the requested mode so each opening starts from a clean form.
  return mode ? <AuthDialog key={mode} initialMode={mode} /> : null;
}

function AuthDialog({ initialMode }: { initialMode: AuthModalMode }) {
  const toast = useToast();
  const [mode, setMode] = useState<AuthModalMode>(initialMode);
  const [choice, setChoice] = useState<ProfileChoice | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const welcome = (nickname: string, claimed: number) => {
    closeAuthModal();
    toast(
      claimed > 0 ? `Chào ${nickname}! Đã lưu ${claimed} ván bạn vừa chơi vào lịch sử.` : `Chào ${nickname}! Lịch sử và thống kê của bạn đã sẵn sàng.`,
      'success',
    );
  };

  return (
    <Modal open onClose={pickerOpen ? undefined : closeAuthModal} labelledBy="auth-title" className="max-h-[calc(100dvh-2rem)] max-w-[440px]! overflow-y-auto p-0!">
      <Hero mode={choice ? 'choice' : mode} />
      <button
        type="button"
        onClick={closeAuthModal}
        className="absolute top-3.5 right-3.5 z-10 grid h-9 w-9 place-items-center rounded-xl bg-white/25 text-white backdrop-blur transition-colors hover:bg-white/40"
        aria-label="Đóng"
      >
        <CloseIcon size={18} />
      </button>

      <div className="px-5 pt-4 pb-5 sm:px-6 sm:pb-6">
        {choice ? (
          <ProfileChoiceStep choice={choice} onDone={(nickname, claimed) => welcome(nickname, claimed)} />
        ) : (
          <>
            <div role="tablist" aria-label="Đăng nhập hoặc đăng ký" className="grid grid-cols-2 gap-1 rounded-2xl bg-slate-100 p-1">
              {(['login', 'register'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={mode === m}
                  onClick={() => setMode(m)}
                  className={cx(
                    'h-10 rounded-xl font-display text-[15px] font-semibold transition-all',
                    mode === m ? 'bg-white text-brand-600 shadow-soft' : 'text-slate-500 hover:text-slate-700',
                  )}
                >
                  {m === 'login' ? 'Đăng nhập' : 'Đăng ký'}
                </button>
              ))}
            </div>

            {mode === 'login' ? (
              <LoginForm
                onSwitch={() => setMode('register')}
                onDone={(res, nickname) => (res.choice ? setChoice(res.choice) : welcome(nickname, res.claimed))}
              />
            ) : (
              <RegisterForm onSwitch={() => setMode('login')} pickerOpen={pickerOpen} setPickerOpen={setPickerOpen} onDone={welcome} />
            )}

            <p className="mt-4 text-center text-xs font-semibold text-slate-400">
              Không bắt buộc đâu —{' '}
              <button type="button" onClick={closeAuthModal} className="font-bold text-brand-500 underline-offset-2 hover:underline">
                chơi tiếp với tư cách khách
              </button>
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}

// ─── Hero ────────────────────────────────────────────────────────────────────

function Hero({ mode }: { mode: AuthModalMode | 'choice' }) {
  const copy = {
    login: { title: 'Chào mừng trở lại!', sub: 'Đăng nhập để tiếp tục lưu lịch sử và thống kê.' },
    register: { title: 'Tạo tài khoản Caro', sub: 'Miễn phí, chỉ cần email. Ván vừa chơi cũng được giữ lại.' },
    choice: { title: 'Dùng hồ sơ nào?', sub: 'Tài khoản của bạn đã có tên và avatar riêng.' },
  }[mode];
  return (
    <div className="t-hero-dots relative overflow-hidden bg-gradient-to-br from-brand-400 via-sky-400 to-emerald-300 px-6 pt-6 pb-5 text-white">
      <div className="pointer-events-none absolute -top-2 right-[68px] grid h-14 w-14 rotate-12 place-items-center rounded-2xl bg-white/90 shadow-lift animate-float">
        <XPiece className="h-9 w-9" />
      </div>
      <div
        className="pointer-events-none absolute right-2 bottom-3 grid h-11 w-11 -rotate-6 place-items-center rounded-2xl bg-white/90 shadow-lift animate-float"
        style={{ animationDelay: '-1.4s' }}
      >
        <OPiece className="h-7 w-7" />
      </div>
      <h2 id="auth-title" className="relative max-w-[70%] font-display text-[26px] leading-tight font-bold drop-shadow-sm">
        {copy.title}
      </h2>
      <p className="relative mt-1 max-w-[80%] text-sm font-semibold text-white/90">{copy.sub}</p>
    </div>
  );
}

// ─── Forms ───────────────────────────────────────────────────────────────────

function LoginForm({ onSwitch, onDone }: { onSwitch: () => void; onDone: (res: { claimed: number; choice: ProfileChoice | null }, nickname: string) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return setError('Nhập email và mật khẩu nhé.');
    setBusy(true);
    setError(null);
    const res = await login(email, password);
    setBusy(false);
    if (!res.ok) return setError(res.message);
    onDone(res, res.choice?.account.nickname ?? (getSavedName() || guestNickname()));
  };

  return (
    <form onSubmit={submit} className="mt-4 space-y-3" noValidate>
      <Field
        label="Email"
        icon={<MailIcon size={18} />}
        type="email"
        autoComplete="email"
        inputMode="email"
        placeholder="ban@email.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        data-autofocus
      />
      <PasswordField label="Mật khẩu" autoComplete="current-password" value={password} onChange={setPassword} />
      <ErrorNote message={error} />
      <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>
        Đăng nhập
      </Button>
      <p className="text-center text-sm text-slate-500">
        Chưa có tài khoản?{' '}
        <button type="button" onClick={onSwitch} className="font-bold text-brand-600 hover:underline">
          Đăng ký miễn phí
        </button>
      </p>
    </form>
  );
}

function RegisterForm({
  onSwitch,
  onDone,
  pickerOpen,
  setPickerOpen,
}: {
  onSwitch: () => void;
  onDone: (nickname: string, claimed: number) => void;
  pickerOpen: boolean;
  setPickerOpen: (open: boolean) => void;
}) {
  // Starts from the guest's current look, so signing up carries it over.
  const [guestName] = useState(guestNickname);
  const [nickname, setNickname] = useState(() => guestName || randomName());
  const [avatar, setAvatar] = useState(getMyAvatar);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nameId = useId();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const name = nickname.trim();
    if (!name) return setError('Chọn một nickname nhé.');
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError('Email chưa đúng định dạng.');
    if (password.length < PASSWORD_MIN) return setError(`Mật khẩu cần ít nhất ${PASSWORD_MIN} ký tự.`);
    setBusy(true);
    setError(null);
    const res = await register({ email: email.trim(), password, nickname: name, avatar });
    setBusy(false);
    if (!res.ok) return setError(res.message);
    onDone(name, res.claimed);
  };

  return (
    <form onSubmit={submit} className="mt-4 space-y-3" noValidate>
      <div className="rounded-2xl bg-gradient-to-br from-brand-50 to-emerald-50 p-3 ring-1 ring-brand-100">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor={nameId} className="text-xs font-bold tracking-wide text-slate-500 uppercase">
            Hồ sơ của bạn
          </label>
          {guestName && (
            <span className="inline-flex items-center gap-1 rounded-full bg-white/80 px-2 py-0.5 text-[11px] font-bold text-emerald-600 ring-1 ring-emerald-100">
              <CheckIcon size={12} /> Mang theo từ chế độ khách
            </span>
          )}
        </div>
        <div className="mt-2 flex items-center gap-3">
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            aria-label="Đổi avatar"
            title="Đổi avatar"
            className="group relative h-14 w-14 shrink-0 rounded-2xl focus-visible:ring-4 focus-visible:ring-brand-200 focus-visible:outline-none"
          >
            <AvatarImage avatar={avatar} seed="me" name={nickname} className="h-full w-full rounded-2xl bg-white ring-2 ring-white shadow-soft transition-transform group-hover:-translate-y-0.5" />
            <span className="absolute -right-1 -bottom-1 grid h-6 w-6 place-items-center rounded-full bg-white text-brand-500 shadow-sm ring-1 ring-slate-200 transition-colors group-hover:bg-brand-500 group-hover:text-white">
              <CameraIcon size={13} />
            </span>
          </button>
          <div className="relative min-w-0 flex-1">
            <input
              id={nameId}
              value={nickname}
              maxLength={20}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="Nickname"
              autoComplete="nickname"
              className="h-12 w-full rounded-2xl bg-white pr-11 pl-4 font-semibold text-slate-700 ring-1 ring-slate-200 outline-none transition-shadow placeholder:font-normal placeholder:text-slate-400 focus:ring-4 focus:ring-brand-100"
            />
            <button
              type="button"
              onClick={() => setNickname((n) => randomName(n.trim()))}
              aria-label="Tên ngẫu nhiên"
              title="Tên ngẫu nhiên"
              className="absolute top-1/2 right-1.5 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-xl text-slate-400 transition-colors hover:bg-brand-50 hover:text-brand-600 active:scale-95"
            >
              <DiceIcon size={19} />
            </button>
          </div>
        </div>
      </div>

      <Field
        label="Email"
        icon={<MailIcon size={18} />}
        type="email"
        autoComplete="email"
        inputMode="email"
        placeholder="ban@email.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <div>
        <PasswordField label="Mật khẩu" autoComplete="new-password" value={password} onChange={setPassword} placeholder={`Ít nhất ${PASSWORD_MIN} ký tự`} />
        <StrengthMeter password={password} />
      </div>

      <ul className="grid grid-cols-3 gap-2 pt-0.5">
        <Perk icon={<HistoryIcon size={16} />} tone="bg-brand-50 text-brand-500">
          Lưu mọi ván đấu
        </Perk>
        <Perk icon={<ChartIcon size={16} />} tone="bg-emerald-50 text-emerald-500">
          Thống kê thắng thua
        </Perk>
        <Perk icon={<SparkIcon size={16} />} tone="bg-violet-50 text-violet-500">
          Lên cấp, giữ hồ sơ
        </Perk>
      </ul>

      <ErrorNote message={error} />
      <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>
        Tạo tài khoản
      </Button>
      <p className="text-center text-sm text-slate-500">
        Đã có tài khoản?{' '}
        <button type="button" onClick={onSwitch} className="font-bold text-brand-600 hover:underline">
          Đăng nhập
        </button>
      </p>

      <AvatarPicker open={pickerOpen} current={avatar} seed="me" onClose={() => setPickerOpen(false)} onSave={setAvatar} />
    </form>
  );
}

// ─── After login: whose look to keep ─────────────────────────────────────────

function ProfileChoiceStep({ choice, onDone }: { choice: ProfileChoice; onDone: (nickname: string, claimed: number) => void }) {
  const [pick, setPick] = useState<'account' | 'guest'>('account');
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    setBusy(true);
    if (pick === 'account') applyAccountProfile();
    else await keepGuestProfile(choice.guest);
    setBusy(false);
    onDone(pick === 'account' ? choice.account.nickname : choice.guest.nickname, 0);
  };

  const option = (key: 'account' | 'guest', title: string, sub: string, nickname: string, avatar: string | null) => (
    <button
      type="button"
      onClick={() => setPick(key)}
      aria-pressed={pick === key}
      className={cx(
        'relative flex flex-col items-center gap-2 rounded-2xl p-3.5 text-center ring-2 transition-all',
        pick === key ? 'bg-brand-50 ring-brand-400 shadow-soft' : 'bg-white ring-slate-200 hover:ring-brand-200',
      )}
    >
      {pick === key && (
        <span className="animate-pop-in absolute top-2 right-2 grid h-6 w-6 place-items-center rounded-full bg-brand-500 text-white">
          <CheckIcon size={14} />
        </span>
      )}
      <AvatarImage avatar={avatar} seed={key} name={nickname} className="h-16 w-16 rounded-2xl bg-slate-50 ring-1 ring-slate-200" />
      <span className="w-full truncate font-display text-base font-bold text-slate-800">{nickname}</span>
      <span className="text-[11px] font-bold tracking-wide text-slate-400 uppercase">{title}</span>
      <span className="text-xs text-slate-500">{sub}</span>
    </button>
  );

  return (
    <div>
      <div className="grid grid-cols-2 gap-3">
        {option('account', 'Tài khoản', 'Hồ sơ đã lưu', choice.account.nickname, choice.account.avatar)}
        {option('guest', 'Đang dùng', 'Cập nhật vào tài khoản', choice.guest.nickname, choice.guest.avatar)}
      </div>
      <p className="mt-3 text-center text-xs font-semibold text-slate-400">Áp dụng cho các phòng mới. Bạn đổi lại lúc nào cũng được trong trang hồ sơ.</p>
      <Button variant="primary" size="lg" className="mt-4 w-full" loading={busy} onClick={confirm} data-autofocus>
        Tiếp tục
      </Button>
    </div>
  );
}

// ─── Bits ────────────────────────────────────────────────────────────────────

function Field({ label, icon, right, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: string; icon: ReactNode; right?: ReactNode }) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-xs font-bold tracking-wide text-slate-400 uppercase">
        {label}
      </label>
      <div className="relative">
        <span className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-slate-400">{icon}</span>
        <input
          id={id}
          {...rest}
          className="h-12 w-full rounded-2xl bg-slate-50 pr-12 pl-11 font-semibold text-slate-700 ring-1 ring-slate-200 outline-none transition-shadow placeholder:font-normal placeholder:text-slate-400 focus:bg-white focus:ring-4 focus:ring-brand-100"
        />
        {right && <span className="absolute top-1/2 right-1.5 -translate-y-1/2">{right}</span>}
      </div>
    </div>
  );
}

function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
  placeholder = '••••••••',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  placeholder?: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <Field
      label={label}
      icon={<LockIcon size={18} />}
      type={visible ? 'text' : 'password'}
      autoComplete={autoComplete}
      placeholder={placeholder}
      value={value}
      maxLength={128}
      onChange={(e) => onChange(e.target.value)}
      right={
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
          title={visible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
          className="grid h-9 w-9 place-items-center rounded-xl text-slate-400 transition-colors hover:bg-brand-50 hover:text-brand-600"
        >
          {visible ? <EyeOffIcon size={18} /> : <EyeIcon size={18} />}
        </button>
      }
    />
  );
}

function passwordScore(p: string) {
  if (p.length < PASSWORD_MIN) return p ? 1 : 0;
  let s = 2;
  if (p.length >= 12) s++;
  if (/[a-z]/.test(p) && /[A-Z]/.test(p)) s++;
  if (/\d/.test(p) && /[^A-Za-z0-9]/.test(p)) s++;
  return Math.min(s, 4);
}

function StrengthMeter({ password }: { password: string }) {
  const score = passwordScore(password);
  if (!password) return null;
  const labels = ['', 'Quá ngắn', 'Tạm được', 'Khá mạnh', 'Rất mạnh'];
  const colors = ['', 'bg-red-400', 'bg-orange-400', 'bg-sky-400', 'bg-emerald-400'];
  return (
    <div className="mt-1.5 flex items-center gap-2" aria-live="polite">
      <div className="grid flex-1 grid-cols-4 gap-1">
        {[1, 2, 3, 4].map((i) => (
          <span key={i} className={cx('h-1.5 rounded-full transition-colors duration-300', i <= score ? colors[score] : 'bg-slate-200')} />
        ))}
      </div>
      <span className="w-16 text-right text-[11px] font-bold text-slate-400">{labels[score]}</span>
    </div>
  );
}

function Perk({ icon, tone, children }: { icon: ReactNode; tone: string; children: ReactNode }) {
  return (
    <li className="flex flex-col items-center gap-1.5 rounded-2xl bg-white p-2 text-center text-[11px] leading-tight font-bold text-slate-600 ring-1 ring-slate-200/70">
      <span className={cx('grid h-7 w-7 place-items-center rounded-lg', tone)}>{icon}</span>
      {children}
    </li>
  );
}

function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="animate-shake rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-600 ring-1 ring-red-100">
      {message}
    </p>
  );
}

/** Small prompt used on guest-facing screens (lobby, result screen). */
export function SignUpNudge({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <button
      type="button"
      onClick={() => openAuthModal('register')}
      className={cx(
        'group flex w-full items-center gap-3 rounded-2xl bg-gradient-to-r from-brand-50 via-sky-50 to-emerald-50 p-3 text-left ring-1 ring-brand-100 transition-all hover:-translate-y-0.5 hover:ring-brand-200',
        className,
      )}
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white text-brand-500 shadow-soft">
        <HistoryIcon size={18} />
      </span>
      <span className="min-w-0 flex-1 text-sm font-semibold text-slate-600">{children}</span>
      <span className="shrink-0 font-display text-sm font-bold text-brand-600 transition-transform group-hover:translate-x-0.5">Đăng ký →</span>
    </button>
  );
}
