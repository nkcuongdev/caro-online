import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router';
import { AchievementsPanel } from '../components/achievements/AchievementsPanel';
import { TitleBadge } from '../components/titles/TitleBadge';
import { NameStylesPanel } from '../components/nameStyles/NameStylesPanel';
import { PlayerName } from '../components/PlayerName';
import { TitlesPanel } from '../components/titles/TitlesPanel';
import { formatCoins } from '../components/achievements/rarity';
import { AccountMenu } from '../components/auth/AccountMenu';
import { AvatarImage } from '../components/Avatar';
import { AvatarFramesPanel } from '../components/avatarFrames/AvatarFramesPanel';
import { AvatarWithFrame } from '../components/AvatarWithFrame';
import { AvatarPicker } from '../components/AvatarPicker';
import { ArrowLeftIcon, CameraIcon, ChartIcon, CheckIcon, CloseIcon, CoinIcon, FrameIcon, HistoryIcon, MailIcon, MedalIcon, NameStyleIcon, PencilIcon, SparkIcon, TrophyIcon, VerifiedIcon } from '../components/icons';
import { OPiece, XPiece } from '../components/Pieces';
import { MatchHistory } from '../components/profile/MatchHistory';
import { formatDate } from '../components/profile/format';
import { BotWins, Highlights, LevelBar, ModeTabs, RecentForm, StatTiles } from '../components/profile/StatsPanels';
import { useToast } from '../components/Toasts';
import { Button, Card, Logo, Spinner } from '../components/ui';
import { cx } from '../lib/cx';
import { fetchMe, openAuthModal, useAccountStats, useAuth } from '../lib/account';
import { setMyAvatar, useMyAvatar } from '../lib/avatar';
import type { RoomMode } from '../lib/protocol';
import { saveName } from '../lib/session';

export type ProfileTab = 'overview' | 'achievements' | 'titles' | 'nameStyles' | 'avatarFrames';

const TAB_SECTION: Record<ProfileTab, string> = { overview: 'Hồ sơ', achievements: 'Thành tích', titles: 'Danh hiệu', nameStyles: 'Hiệu ứng tên', avatarFrames: 'Khung avatar' };

export function ProfilePage({ tab = 'overview' }: { tab?: ProfileTab }) {
  const { user } = useAuth();
  const stats = useAccountStats();
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<RoomMode | null>(null);
  const location = useLocation();

  useEffect(() => {
    const section = TAB_SECTION[tab];
    document.title = user ? `${user.nickname} — ${section} Caro Online` : `${section} — Caro Online`;
  }, [user, tab]);

  useEffect(() => {
    if (!user) return;
    let live = true;
    void fetchMe().then((res) => live && setLoadError(res.ok ? null : res.message));
    return () => {
      live = false;
    };
    // Refetch when a different account signs in; not on every profile edit.
  }, [user?.id]);

  useEffect(() => {
    if (location.hash === '#history' && stats) document.getElementById('history')?.scrollIntoView({ behavior: 'smooth' });
  }, [location.hash, stats]);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between gap-2 px-4 py-4 sm:px-6">
        <div className="flex items-center gap-3">
          <Logo responsive />
          <Link
            to="/"
            className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-white/80 px-3 text-sm font-bold text-slate-500 shadow-soft ring-1 ring-slate-200/70 transition-all hover:-translate-y-0.5 hover:text-brand-600"
          >
            <ArrowLeftIcon size={16} /> Về sảnh
          </Link>
        </div>
        <AccountMenu />
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-12 sm:px-6">
        {!user ? (
          <GuestProfile />
        ) : !stats ? (
          <div className="grid place-items-center py-24 text-brand-500">
            {loadError ? (
              <Card className="max-w-sm p-6 text-center">
                <p className="font-semibold text-slate-600">{loadError}</p>
                <Button variant="primary" className="mt-4" onClick={() => void fetchMe().then((r) => setLoadError(r.ok ? null : r.message))}>
                  Thử lại
                </Button>
              </Card>
            ) : (
              <Spinner className="h-8 w-8" />
            )}
          </div>
        ) : (
          <div className="animate-fade-up space-y-8">
            <ProfileHero />
            <ProfileTabs />

            {tab === 'achievements' ? (
              <AchievementsPanel />
            ) : tab === 'titles' ? (
              <TitlesPanel />
            ) : tab === 'nameStyles' ? (
              <NameStylesPanel />
            ) : tab === 'avatarFrames' ? (
              <AvatarFramesPanel />
            ) : (
              <>
                <section>
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <h2 className="flex items-center gap-2 font-display text-2xl font-bold text-slate-800">
                      <ChartIcon size={22} className="text-emerald-500" /> Thống kê
                    </h2>
                    <ModeTabs value={mode} onChange={setMode} />
                  </div>
                  <div className="mt-4 space-y-3">
                    <StatTiles s={mode ? stats.byMode[mode] : stats.overall} />
                    <Highlights stats={stats} />
                    <div className="grid gap-3 md:grid-cols-2">
                      <RecentForm form={stats.recentForm} />
                      <BotWins wins={stats.botWins} />
                    </div>
                  </div>
                </section>

                <MatchHistory />
              </>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function ProfileHero() {
  const { user } = useAuth();
  const stats = useAccountStats();
  const avatar = useMyAvatar();
  const toast = useToast();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  if (!user || !stats) return null;

  // The browser's copy mirrors the profile (and updates first), and it's what the lobby and rooms use.
  const face = avatar;

  const saveNickname = (e: FormEvent) => {
    e.preventDefault();
    const value = draft.trim();
    if (!value) return;
    saveName(value); // mirrored to the account by lib/account
    setEditing(false);
    toast('Đã lưu nickname mới.', 'success');
  };

  return (
    <Card className="overflow-hidden">
      <div className="t-hero-dots relative h-28 bg-gradient-to-r from-brand-400 via-sky-400 to-emerald-300 sm:h-32">
        <div className="absolute top-5 right-8 hidden rotate-12 rounded-2xl bg-white/85 p-2 shadow-lift sm:block animate-float">
          <XPiece className="h-9 w-9" />
        </div>
        <div className="absolute right-28 bottom-4 hidden -rotate-6 rounded-2xl bg-white/85 p-1.5 shadow-lift sm:block animate-float" style={{ animationDelay: '-1.6s' }}>
          <OPiece className="h-7 w-7" />
        </div>
      </div>
      <div className="grid gap-5 px-5 pb-5 sm:px-7 sm:pb-6 md:grid-cols-[1fr_minmax(0,340px)] md:items-end">
        <div className="-mt-12 flex flex-col items-center gap-3 text-center sm:-mt-14 sm:flex-row sm:items-start sm:text-left">
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            aria-label="Đổi avatar"
            className="group relative shrink-0 rounded-[28px] focus-visible:ring-4 focus-visible:ring-brand-200 focus-visible:outline-none"
          >
            <AvatarWithFrame avatar={face} frameId={user.avatarFrame} seed={user.id} name={user.nickname} className="h-24 w-24 rounded-[28px] bg-white shadow-lift ring-4 ring-white sm:h-28 sm:w-28" />
            <span className="absolute right-0 bottom-0 grid h-8 w-8 place-items-center rounded-full bg-white text-brand-500 shadow-soft ring-1 ring-slate-200 transition-colors group-hover:bg-brand-500 group-hover:text-white">
              <CameraIcon size={16} />
            </span>
          </button>
          {/* Starts below the banner whatever its height (a title plate is tall), while the avatar overlaps it. */}
          <div className="min-w-0 pb-1 sm:pt-[3.75rem]">
            {editing ? (
              <form onSubmit={saveNickname} className="flex items-center gap-1.5">
                <input
                  autoFocus
                  value={draft}
                  maxLength={20}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => e.key === 'Escape' && setEditing(false)}
                  aria-label="Nickname"
                  className="h-11 w-full max-w-[240px] rounded-xl bg-slate-50 px-3 font-display text-xl font-bold text-slate-800 ring-1 ring-slate-200 outline-none focus:bg-white focus:ring-4 focus:ring-brand-100"
                />
                <button type="submit" aria-label="Lưu" className="grid h-10 w-10 place-items-center rounded-xl bg-brand-500 text-white hover:bg-brand-600">
                  <CheckIcon size={18} />
                </button>
                <button type="button" aria-label="Hủy" onClick={() => setEditing(false)} className="grid h-10 w-10 place-items-center rounded-xl text-slate-400 hover:bg-slate-100">
                  <CloseIcon size={18} />
                </button>
              </form>
            ) : (
              <div className="flex items-center justify-center gap-2 sm:justify-start">
                <PlayerName as="h1" name={user.nickname} nameStyle={user.nameStyle} className="truncate font-display text-3xl font-bold text-slate-800" />
                <span title="Thành viên đã đăng ký">
                  <VerifiedIcon size={22} className="shrink-0 text-brand-500" />
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setDraft(user.nickname);
                    setEditing(true);
                  }}
                  aria-label="Đổi nickname"
                  title="Đổi nickname"
                  className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-brand-50 hover:text-brand-600"
                >
                  <PencilIcon size={16} />
                </button>
              </div>
            )}
            <div className="mt-1 flex min-w-0 items-center justify-center gap-2 sm:justify-start">
              {user.title ? (
                <>
                  <TitleBadge title={user.title} size="md" />
                  <Link to="/me/titles" className="shrink-0 text-xs font-bold text-slate-400 hover:text-brand-600 hover:underline">
                    Đổi
                  </Link>
                </>
              ) : (
                <Link to="/me/titles" className="text-xs font-bold text-brand-600 hover:underline">
                  + Chọn danh hiệu
                </Link>
              )}
            </div>
            <p className="mt-1 flex flex-wrap items-center justify-center gap-x-3 gap-y-0.5 text-sm font-semibold text-slate-500 sm:justify-start">
              <span className="inline-flex items-center gap-1">
                <MailIcon size={14} /> {user.email}
              </span>
              <span>Tham gia {formatDate(user.createdAt)}</span>
              <Link
                to="/me/achievements"
                title="Coin nhận từ thành tích"
                className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 font-bold text-amber-700 ring-1 ring-amber-200 transition-colors hover:bg-amber-100"
              >
                <CoinIcon size={14} /> {formatCoins(user.coins ?? 0)}
              </Link>
            </p>
          </div>
        </div>
        <LevelBar stats={stats} className="shadow-soft" />
      </div>

      <AvatarPicker
        open={pickerOpen}
        current={face}
        seed={user.id}
        onClose={() => setPickerOpen(false)}
        onSave={(value) => {
          setMyAvatar(value); // mirrored to the account by lib/account
          toast('Đã đổi avatar.', 'success');
        }}
      />
    </Card>
  );
}

function ProfileTabs() {
  const tabs = [
    { to: '/me', label: 'Thống kê & lịch sử', icon: <ChartIcon size={17} /> },
    { to: '/me/achievements', label: 'Thành tích', icon: <TrophyIcon size={17} /> },
    { to: '/me/titles', label: 'Danh hiệu', icon: <MedalIcon size={17} /> },
    { to: '/me/name-styles', label: 'Hiệu ứng tên', icon: <NameStyleIcon size={17} /> },
    { to: '/me/avatar-frames', label: 'Khung avatar', icon: <FrameIcon size={17} /> },
  ];
  return (
    <nav aria-label="Hồ sơ" className="flex max-w-full gap-1 overflow-x-auto rounded-2xl bg-white/80 p-1 shadow-soft ring-1 ring-slate-200/70 sm:inline-flex">
      {tabs.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end
          className={({ isActive }) =>
            cx(
              'inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl px-4 font-display text-[15px] font-semibold whitespace-nowrap transition-all sm:flex-none',
              isActive ? 'bg-gradient-to-b from-brand-400 to-brand-600 text-white shadow-[0_6px_14px_-6px_rgb(37_99_235/0.6)]' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700',
            )
          }
        >
          {t.icon}
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}

function GuestProfile() {
  const avatar = useMyAvatar();
  return (
    <Card className="mx-auto mt-6 max-w-2xl overflow-hidden text-center">
      <div className="t-hero-dots relative bg-gradient-to-br from-brand-400 via-sky-400 to-emerald-300 px-6 pt-10 pb-16">
        <p className="relative font-display text-3xl font-bold text-white drop-shadow-sm sm:text-4xl">Bạn đang chơi với tư cách khách</p>
        <p className="relative mt-2 font-semibold text-white/90">Vẫn chơi thoải mái như cũ. Có tài khoản thì mọi ván đấu đều được ghi lại.</p>
      </div>
      <div className="-mt-10 px-6 pb-8">
        <AvatarImage avatar={avatar} seed="me" name="Bạn" className="mx-auto h-20 w-20 rounded-[24px] bg-white shadow-lift ring-4 ring-white" />
        <ul className="mx-auto mt-6 grid max-w-lg gap-3 text-left sm:grid-cols-3">
          <Perk icon={<HistoryIcon size={18} />} tone="bg-brand-50 text-brand-500" title="Lịch sử đầy đủ" text="Xem lại từng nước của mọi ván." />
          <Perk icon={<ChartIcon size={18} />} tone="bg-emerald-50 text-emerald-500" title="Thống kê cá nhân" text="Số trận, thắng thua, win rate." />
          <Perk icon={<SparkIcon size={18} />} tone="bg-violet-50 text-violet-500" title="Hồ sơ & thành tích" text="Cấp độ, thành tích, coin thưởng." />
        </ul>
        <div className="mx-auto mt-7 grid max-w-sm grid-cols-2 gap-2.5">
          <Button variant="primary" size="lg" onClick={() => openAuthModal('register')}>
            Đăng ký
          </Button>
          <Button variant="secondary" size="lg" onClick={() => openAuthModal('login')}>
            Đăng nhập
          </Button>
        </div>
        <p className="mt-4 text-xs font-semibold text-slate-400">Nickname, avatar và các ván vừa chơi sẽ được mang sang tài khoản.</p>
      </div>
    </Card>
  );
}

function Perk({ icon, tone, title, text }: { icon: ReactNode; tone: string; title: string; text: string }) {
  return (
    <li className="rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-100">
      <span className={`grid h-9 w-9 place-items-center rounded-xl ${tone}`}>{icon}</span>
      <p className="mt-2 font-display font-bold text-slate-700">{title}</p>
      <p className="text-xs text-slate-500">{text}</p>
    </li>
  );
}
