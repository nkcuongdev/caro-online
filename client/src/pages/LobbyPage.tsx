import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { AccountMenu } from '../components/auth/AccountMenu';
import { MyAvatarButton } from '../components/AvatarPicker';
import { BotSetupModal } from '../components/BotSetupModal';
import { ArrowRightIcon, BookIcon, BotIcon, PlusIcon, SparkIcon, TimerIcon, UsersIcon, ZapIcon } from '../components/icons';
import { NameInput } from '../components/NameInput';
import { OPiece, XPiece } from '../components/Pieces';
import { BoardSizePicker, TurnTimePicker } from '../components/RoomSettingsPicker';
import { RulesModal } from '../components/RulesModal';
import { useToast } from '../components/Toasts';
import { Trophy } from '../components/tournament/parts';
import { TournamentSetupModal } from '../components/tournament/TournamentSetupModal';
import { Button, Card, Logo } from '../components/ui';
import { useCreateTournament } from '../hooks/useTournament';
import { openAuthModal, useAccountStats, useAuth } from '../lib/account';
import { getMyAvatar } from '../lib/avatar';
import { cx } from '../lib/cx';
import { apiUrl } from '../lib/env';
import { parseRoomInput } from '../lib/game';
import type { BotSettings } from '../lib/protocol';
import {
  getSavedBoardSize,
  getSavedName,
  getSavedTurnSeconds,
  saveBoardSize,
  saveBotSettings,
  saveName,
  saveSession,
  saveTurnSeconds,
} from '../lib/session';
import { request } from '../lib/socket';

export function LobbyPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [name, setName] = useState(getSavedName);
  const { user } = useAuth();
  const stats = useAccountStats();
  // Signing in (here or in another tab) brings the profile's nickname into the field.
  useEffect(() => {
    if (user?.nickname) setName(user.nickname);
  }, [user?.nickname]);
  const [boardSize, setBoardSize] = useState(getSavedBoardSize);
  const [turnSeconds, setTurnSeconds] = useState(getSavedTurnSeconds);
  const [roomInput, setRoomInput] = useState('');
  const [creating, setCreating] = useState(false);
  const [botOpen, setBotOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [creatingBot, setCreatingBot] = useState(false);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [online, setOnline] = useState<number | null>(null);
  const [tournamentOpen, setTournamentOpen] = useState(false);
  const onTournamentError = useCallback((message: string) => toast(message, 'error'), [toast]);
  const { create: createTournament, creating: creatingTournament } = useCreateTournament(onTournamentError);

  useEffect(() => {
    document.title = 'Caro Online — Chơi cờ caro cùng bạn bè';
    const ctrl = new AbortController();
    fetch(apiUrl('/api/stats'), { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((s: { playersOnline: number } | null) => s && setOnline(s.playersOnline))
      .catch(() => {});
    return () => ctrl.abort();
  }, []);

  const create = async () => {
    setCreating(true);
    const trimmed = name.trim();
    if (trimmed) saveName(trimmed);
    const res = await request<{ roomId: string; playerId: string; token: string }>('room:create', {
      name: trimmed || undefined,
      boardSize,
      turnSeconds,
      avatar: getMyAvatar(),
    });
    setCreating(false);
    if (!res.ok) {
      toast(res.message, 'error');
      return;
    }
    saveSession(res.roomId, res.playerId, res.token);
    navigate(`/game/${res.roomId}`);
  };

  const createBot = async (settings: BotSettings) => {
    setCreatingBot(true);
    saveBotSettings(settings);
    const trimmed = name.trim();
    if (trimmed) saveName(trimmed);
    const res = await request<{ roomId: string; playerId: string; token: string }>('room:createBot', {
      name: trimmed || undefined,
      boardSize,
      turnSeconds,
      avatar: getMyAvatar(),
      ...settings,
    });
    setCreatingBot(false);
    if (!res.ok) {
      toast(res.message, 'error');
      return;
    }
    saveSession(res.roomId, res.playerId, res.token);
    navigate(`/game/${res.roomId}`);
  };

  const join = async (e: FormEvent) => {
    e.preventDefault();
    // A pasted tournament link goes straight to its lobby.
    const tournamentFromUrl = roomInput.trim().match(/\/t\/([A-Za-z0-9]{4,16})/)?.[1];
    if (tournamentFromUrl) {
      navigate(`/t/${tournamentFromUrl}`);
      return;
    }
    const id = parseRoomInput(roomInput);
    if (!id) {
      setJoinError('Mã phòng không hợp lệ, ví dụ: a8Kd92.');
      return;
    }
    setJoinError(null);
    setJoining(true);
    if (name.trim()) saveName(name);
    try {
      const res = await fetch(apiUrl(`/api/rooms/${id}`));
      const info = res.ok ? ((await res.json()) as { exists: boolean }) : null;
      if (info && !info.exists) {
        // The same box takes tournament codes.
        const t = await fetch(apiUrl(`/api/tournaments/${id}`))
          .then((r) => (r.ok ? (r.json() as Promise<{ exists: boolean }>) : null))
          .catch(() => null);
        if (t?.exists) {
          navigate(`/t/${id}`);
          return;
        }
        setJoinError('Không tìm thấy phòng hay giải đấu nào với mã này. Hãy kiểm tra lại với bạn của bạn.');
        return;
      }
    } catch {
      // API unreachable: let the game page handle it over the socket.
    } finally {
      setJoining(false);
    }
    navigate(`/game/${id}`);
  };

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
        <Logo />
        <div className="flex items-center gap-2">
          {online !== null && online > 0 && (
            <span className="hidden items-center gap-2 rounded-full bg-white/80 px-3 py-1.5 text-xs font-bold text-slate-500 shadow-soft ring-1 ring-slate-200/70 sm:inline-flex">
              <span className="relative flex h-2 w-2">
                <span className="absolute inset-0 animate-ping-soft rounded-full bg-emerald-400" />
                <span className="relative h-2 w-2 rounded-full bg-emerald-400" />
              </span>
              {online} người đang chơi
            </span>
          )}
          <Button variant="secondary" size="sm" icon={<BookIcon size={16} />} onClick={() => setRulesOpen(true)} aria-label="Luật chơi">
            <span className="hidden sm:inline">Luật chơi</span>
          </Button>
          <AccountMenu />
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-6xl flex-1 items-center gap-10 px-4 pb-10 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:gap-14">
        <section className="animate-fade-up">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/80 px-3 py-1 text-xs font-bold tracking-wide text-brand-600 uppercase shadow-soft ring-1 ring-brand-100">
            <SparkIcon size={14} /> Bàn 15×15 đến 30×30 · 5 quân liên tiếp
          </span>
          <h1 className="mt-4 font-display text-5xl leading-[1.05] font-bold tracking-tight text-slate-800 sm:text-6xl">
            Chơi Caro{' '}
            <span className="bg-gradient-to-r from-brand-500 via-sky-400 to-emerald-400 bg-clip-text text-transparent">Online</span>
          </h1>
          <p className="mt-3 max-w-md text-lg text-slate-500">Tạo phòng, mời bạn bè và bắt đầu chơi ngay.</p>

          <Card className="mt-7 max-w-lg p-5 sm:p-6">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="nickname" className="block text-xs font-bold tracking-wide text-slate-400 uppercase">
                {user ? 'Hồ sơ của bạn' : 'Tên & avatar của bạn'}
              </label>
              {user ? (
                <Link to="/me" className="inline-flex items-center gap-1 text-xs font-bold text-brand-600 hover:underline">
                  {stats && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700">Cấp {stats.level}</span>}
                  Thống kê →
                </Link>
              ) : (
                <button type="button" onClick={() => openAuthModal('register')} className="text-xs font-bold text-brand-600 hover:underline">
                  Lưu lịch sử & thống kê →
                </button>
              )}
            </div>
            <div className="mt-1.5 flex items-center gap-3">
              <MyAvatarButton seed="me" className="h-12 w-12" />
              <NameInput id="nickname" value={name} onChange={setName} placeholder="VD: Mèo Lanh Lợi (không bắt buộc)" />
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2 sm:gap-3">
              <BoardSizePicker
                value={boardSize}
                onChange={(size) => {
                  setBoardSize(size);
                  saveBoardSize(size);
                }}
              />
              <TurnTimePicker
                value={turnSeconds}
                onChange={(seconds) => {
                  setTurnSeconds(seconds);
                  saveTurnSeconds(seconds);
                }}
              />
            </div>

            <Button variant="primary" size="lg" className="mt-4 w-full" icon={<PlusIcon size={22} />} loading={creating} onClick={create}>
              Tạo phòng mới
            </Button>
            <div className="mt-2.5 grid grid-cols-2 gap-2.5">
              <Button variant="secondary" size="lg" className="w-full px-3" icon={<BotIcon size={22} />} onClick={() => setBotOpen(true)}>
                Chơi với Bot
              </Button>
              <button
                type="button"
                onClick={() => setTournamentOpen(true)}
                className="t-shine group inline-flex h-14 items-center justify-center gap-2 rounded-2xl bg-gradient-to-br from-amber-300 via-orange-400 to-coral-500 px-3 font-display text-lg font-semibold text-white shadow-[0_8px_18px_-8px_rgb(249_115_22/0.7)] transition-all duration-150 hover:-translate-y-0.5 hover:brightness-105 focus-visible:ring-4 focus-visible:ring-amber-200 focus-visible:outline-none active:scale-[0.97]"
              >
                <Trophy className="relative h-7 w-7 transition-transform duration-300 group-hover:-rotate-12" />
                <span className="relative">Giải đấu</span>
              </button>
            </div>

            <div className="my-5 flex items-center gap-3 text-xs font-bold tracking-wide text-slate-300 uppercase">
              <span className="h-px flex-1 bg-slate-200" />
              hoặc vào phòng của bạn bè
              <span className="h-px flex-1 bg-slate-200" />
            </div>

            <form onSubmit={join} className="flex flex-col gap-2 sm:flex-row">
              <label htmlFor="room-id" className="sr-only">
                Mã phòng
              </label>
              <input
                id="room-id"
                value={roomInput}
                onChange={(e) => {
                  setRoomInput(e.target.value);
                  setJoinError(null);
                }}
                placeholder="Nhập mã phòng"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                className={cx(
                  'h-12 min-w-0 flex-1 rounded-2xl bg-slate-50 px-4 font-display font-semibold tracking-wider text-slate-700 ring-1 outline-none transition-shadow placeholder:font-sans placeholder:font-normal placeholder:tracking-normal placeholder:text-slate-400 focus:bg-white focus:ring-4',
                  joinError ? 'animate-shake ring-red-200 focus:ring-red-100' : 'ring-slate-200 focus:ring-brand-100',
                )}
              />
              <Button type="submit" variant="secondary" className="h-12" loading={joining} icon={!joining && <ArrowRightIcon size={18} />}>
                Vào phòng
              </Button>
            </form>
            {joinError && <p className="mt-2 text-sm font-semibold text-red-500">{joinError}</p>}
          </Card>

          <ul className="mt-6 grid max-w-lg grid-cols-2 gap-2.5 sm:grid-cols-4">
            <Feature icon={<UsersIcon size={18} />} tone="bg-brand-50 text-brand-500">
              Chơi online 2 người
            </Feature>
            <Feature icon={<ZapIcon size={18} />} tone="bg-emerald-50 text-emerald-500">
              Đồng bộ tức thì
            </Feature>
            <Feature icon={<TimerIcon size={18} />} tone="bg-orange-50 text-orange-500">
              15–60 giây mỗi lượt
            </Feature>
            <Feature icon={<SparkIcon size={18} />} tone="bg-violet-50 text-violet-500">
              Không cần tài khoản
            </Feature>
          </ul>
        </section>

        <section className="hidden lg:block" aria-hidden="true">
          <BoardIllustration />
        </section>
      </main>

      <BotSetupModal open={botOpen} loading={creatingBot} boardSize={boardSize} turnSeconds={turnSeconds} onStart={createBot} onClose={() => setBotOpen(false)} />

      <TournamentSetupModal
        open={tournamentOpen}
        loading={creatingTournament}
        boardSize={boardSize}
        turnSeconds={turnSeconds}
        onClose={() => setTournamentOpen(false)}
        onStart={(settings) => {
          if (name.trim()) saveName(name.trim());
          void createTournament(settings);
        }}
      />

      <RulesModal open={rulesOpen} onClose={() => setRulesOpen(false)} />

      <footer className="px-4 pb-5 text-center text-xs font-semibold text-slate-400">
        Xếp đúng 5 quân liên tiếp theo hàng ngang, hàng dọc hoặc đường chéo để thắng (6 quân trở lên không tính) — trừ khi bị đối phương chặn cả hai đầu.{' '}
        <button type="button" onClick={() => setRulesOpen(true)} className="font-bold text-brand-500 underline-offset-2 hover:underline">
          Xem luật chơi
        </button>
      </footer>
    </div>
  );
}

function Feature({ icon, tone, children }: { icon: ReactNode; tone: string; children: ReactNode }) {
  return (
    <li className="flex items-center gap-2 rounded-2xl bg-white/80 p-2.5 text-xs font-bold text-slate-600 shadow-soft ring-1 ring-slate-200/60 sm:flex-col sm:text-center">
      <span className={cx('grid h-8 w-8 shrink-0 place-items-center rounded-xl', tone)}>{icon}</span>
      {children}
    </li>
  );
}

/** Decorative mini board with a winning diagonal. */
function BoardIllustration() {
  const N = 9;
  const pieces: Record<number, 'X' | 'O'> = {
    [1 * N + 2]: 'O', [2 * N + 2]: 'X', [2 * N + 3]: 'O', [3 * N + 3]: 'X', [3 * N + 5]: 'O',
    [4 * N + 4]: 'X', [4 * N + 3]: 'O', [5 * N + 5]: 'X', [5 * N + 2]: 'O', [6 * N + 6]: 'X', [6 * N + 4]: 'O', [2 * N + 6]: 'O',
  };
  const win = new Set([2 * N + 2, 3 * N + 3, 4 * N + 4, 5 * N + 5, 6 * N + 6]);
  return (
    <div className="relative mx-auto max-w-[480px]">
      <div className="absolute -top-8 -left-6 h-40 w-40 rounded-full bg-sky-200/50 blur-3xl" />
      <div className="absolute -right-6 -bottom-8 h-44 w-44 rounded-full bg-emerald-200/50 blur-3xl" />
      <div className="relative rotate-[-3deg] rounded-[32px] bg-white p-3 shadow-lift ring-1 ring-slate-200/70 transition-transform duration-500 hover:rotate-0">
        <div className="grid gap-px overflow-hidden rounded-[22px] border border-slate-200 bg-slate-200/90" style={{ gridTemplateColumns: `repeat(${N}, minmax(0, 1fr))` }}>
          {Array.from({ length: N * N }, (_, i) => (
            <div key={i} className={cx('grid aspect-square place-items-center', win.has(i) ? 'bg-emerald-100' : 'bg-paper')}>
              {pieces[i] === 'X' && <XPiece className="h-[78%] w-[78%]" />}
              {pieces[i] === 'O' && <OPiece className="h-[78%] w-[78%]" />}
            </div>
          ))}
        </div>
      </div>
      <div className="absolute -right-4 top-10 animate-float rounded-2xl bg-white px-4 py-2.5 shadow-lift ring-1 ring-slate-200/70">
        <div className="text-[11px] font-bold tracking-wide text-slate-400 uppercase">Lượt của bạn</div>
        <div className="tabular font-display text-2xl font-bold text-sky-600">00:24</div>
      </div>
      <div
        className="absolute -left-6 bottom-12 animate-float rounded-2xl bg-white px-4 py-2.5 shadow-lift ring-1 ring-slate-200/70"
        style={{ animationDelay: '-1.5s' }}
      >
        <div className="flex items-center gap-2 font-display font-bold text-emerald-600">
          <XPiece className="h-5 w-5" /> 5 quân liên tiếp!
        </div>
      </div>
    </div>
  );
}
