import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { fetchMe, logout, openAuthModal, useAccountStats, useAuth } from '../../lib/account';
import { useMyAvatar } from '../../lib/avatar';
import { cx } from '../../lib/cx';
import { AvatarWithFrame } from '../AvatarWithFrame';
import { PlayerName } from '../PlayerName';
import { formatCoins } from '../achievements/rarity';
import { ChartIcon, ChevronDownIcon, CoinIcon, HistoryIcon, LogOutIcon, MedalIcon, NameStyleIcon, TrophyIcon, UserIcon } from '../icons';
import { TitleBadge } from '../titles/TitleBadge';
import { useToast } from '../Toasts';

/**
 * Header entry point for accounts. Guests see a "Đăng nhập" pill (the game
 * never requires it); signed-in players see their avatar, level and a menu.
 * `compact` fits the crowded game header: an icon-sized button only.
 */
export function AccountMenu({ compact }: { compact?: boolean }) {
  const { user } = useAuth();
  const stats = useAccountStats();
  const avatar = useMyAvatar();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    // Opening the menu is a good moment to refresh the level after recent games.
    void fetchMe();
    const onDown = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!user) {
    return compact ? (
      <button
        type="button"
        onClick={() => openAuthModal('login')}
        aria-label="Đăng nhập"
        title="Đăng nhập để lưu lịch sử"
        className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white text-slate-500 shadow-soft ring-1 ring-slate-200/80 transition-all hover:-translate-y-0.5 hover:text-brand-600 hover:ring-brand-200 active:scale-95"
      >
        <UserIcon size={18} />
      </button>
    ) : (
      <button
        type="button"
        onClick={() => openAuthModal('login')}
        className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-gradient-to-b from-brand-400 to-brand-600 px-3 font-display text-sm font-semibold text-white shadow-[0_6px_16px_-6px_rgb(37_99_235/0.55)] transition-all hover:-translate-y-0.5 hover:brightness-105 focus-visible:ring-4 focus-visible:ring-brand-200 focus-visible:outline-none active:scale-[0.97]"
      >
        <UserIcon size={16} />
        Đăng nhập
      </button>
    );
  }

  // The live avatar (it mirrors the profile) so a change shows here at once.
  const face = avatar || user.avatar;

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Tài khoản ${user.nickname}`}
        className={cx(
          'inline-flex items-center gap-2 rounded-xl bg-white shadow-soft ring-1 ring-slate-200/80 transition-all hover:-translate-y-0.5 hover:ring-brand-200 focus-visible:ring-4 focus-visible:ring-brand-200 focus-visible:outline-none',
          compact ? 'h-10 w-10 justify-center p-0' : 'h-10 py-1 pr-2 pl-1',
        )}
      >
        <span className="relative">
          <AvatarWithFrame avatar={face} frameId={user.avatarFrame} seed={user.id} name={user.nickname} className="h-8 w-8 rounded-[10px] bg-brand-50" animated={false} />
          {stats && (
            <span className="absolute -right-1.5 -bottom-1 grid h-4 min-w-4 place-items-center rounded-full bg-gradient-to-b from-amber-300 to-amber-500 px-1 text-[9px] leading-none font-extrabold text-white ring-2 ring-white">
              {stats.level}
            </span>
          )}
        </span>
        {!compact && (
          <>
            <PlayerName name={user.nickname} nameStyle={user.nameStyle} className="hidden max-w-[120px] truncate font-display text-sm font-semibold text-slate-700 sm:inline" />
            <ChevronDownIcon size={16} className={cx('hidden text-slate-400 transition-transform sm:block', open && 'rotate-180')} />
          </>
        )}
      </button>

      {open && (
        <div role="menu" className="animate-pop-in absolute top-full right-0 z-40 mt-2 w-64 origin-top-right rounded-2xl bg-white p-2 shadow-lift ring-1 ring-slate-200/80">
          <div className="flex items-center gap-3 rounded-xl bg-gradient-to-br from-brand-50 to-emerald-50 p-3">
            <AvatarWithFrame avatar={face} frameId={user.avatarFrame} seed={user.id} name={user.nickname} className="h-11 w-11 rounded-xl bg-white ring-2 ring-white" />
            <div className="min-w-0">
              <PlayerName as="p" name={user.nickname} nameStyle={user.nameStyle} className="truncate font-display text-base font-bold text-slate-800" />
              {user.title && <TitleBadge title={user.title} size="sm" className="my-0.5" />}
              <p className="truncate text-xs font-semibold text-slate-500">{user.email}</p>
              <p className="mt-0.5 inline-flex items-center gap-1 text-xs font-extrabold text-amber-700" title="Coin">
                <CoinIcon size={13} /> {formatCoins(user.coins ?? 0)}
              </p>
            </div>
          </div>
          {stats && (
            <div className="grid grid-cols-3 gap-1 px-1 py-2 text-center">
              <MiniStat label="Cấp" value={stats.level} tone="text-amber-500" />
              <MiniStat label="Trận" value={stats.overall.games} tone="text-slate-700" />
              <MiniStat label="Thắng" value={`${Math.round(stats.overall.winRate)}%`} tone="text-emerald-600" />
            </div>
          )}
          {/* From a game (compact), a new tab: leaving the page mid-match would start the forfeit countdown. */}
          <MenuLink to="/me" newTab={compact} icon={<ChartIcon size={17} />} onClick={() => setOpen(false)}>
            Hồ sơ & thống kê
          </MenuLink>
          <MenuLink to="/me/achievements" newTab={compact} icon={<TrophyIcon size={17} />} onClick={() => setOpen(false)}>
            Thành tích
          </MenuLink>
          <MenuLink to="/me/titles" newTab={compact} icon={<MedalIcon size={17} />} onClick={() => setOpen(false)}>
            Danh hiệu
          </MenuLink>
          <MenuLink to="/me/name-styles" newTab={compact} icon={<NameStyleIcon size={17} />} onClick={() => setOpen(false)}>
            Hiệu ứng tên
          </MenuLink>
          <MenuLink to="/me#history" newTab={compact} icon={<HistoryIcon size={17} />} onClick={() => setOpen(false)}>
            Lịch sử trận đấu
          </MenuLink>
          <div className="my-1 h-px bg-slate-100" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              void logout();
              toast('Đã đăng xuất. Bạn vẫn chơi tiếp được với tư cách khách.', 'info');
            }}
            className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-bold text-slate-500 transition-colors hover:bg-red-50 hover:text-red-500"
          >
            <LogOutIcon size={17} /> Đăng xuất
          </button>
        </div>
      )}
    </div>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: number | string; tone: string }) {
  return (
    <div className="rounded-xl bg-slate-50 py-1.5">
      <div className={cx('tabular font-display text-lg leading-tight font-bold', tone)}>{value}</div>
      <div className="text-[10px] font-bold tracking-wide text-slate-400 uppercase">{label}</div>
    </div>
  );
}

function MenuLink({ to, icon, children, onClick, newTab }: { to: string; icon: ReactNode; children: ReactNode; onClick: () => void; newTab?: boolean }) {
  return (
    <Link
      to={to}
      role="menuitem"
      onClick={onClick}
      {...(newTab ? { target: '_blank', rel: 'noopener' } : {})}
      className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-bold text-slate-600 transition-colors hover:bg-brand-50 hover:text-brand-600"
    >
      <span className="text-slate-400">{icon}</span>
      {children}
    </Link>
  );
}
