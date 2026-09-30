import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { CopyIcon, LogOutIcon, VolumeOffIcon, VolumeOnIcon } from '../components/icons';
import { useCopyInvite } from '../components/InvitePanel';
import { ConfirmDialog } from '../components/Modal';
import { useToast } from '../components/Toasts';
import { Bracket } from '../components/tournament/Bracket';
import { ChampionModal } from '../components/tournament/ChampionModal';
import { SpectatorPill, Trophy } from '../components/tournament/parts';
import { ReadyCheckModal } from '../components/tournament/ReadyCheckModal';
import { TournamentLobby } from '../components/tournament/TournamentLobby';
import { LiveStrip, MyJourney, TournamentHero } from '../components/tournament/TournamentPanels';
import { TournamentSetupModal } from '../components/tournament/TournamentSetupModal';
import { AccountMenu } from '../components/auth/AccountMenu';
import { Button, Card, IconButton, Logo, Spinner } from '../components/ui';
import { useMatchLauncher } from '../hooks/useMatchLauncher';
import { useSound } from '../hooks/useSound';
import { useCreateTournament, useTournament } from '../hooks/useTournament';
import { setMyAvatar } from '../lib/avatar';
import { cx } from '../lib/cx';
import { tournamentLink } from '../lib/env';
import { getSavedBoardSize, getSavedTurnSeconds } from '../lib/session';
import { sfx } from '../lib/sound';

export function TournamentPage() {
  const { tournamentId = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [soundOn, setSoundOn] = useSound();
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [championOpen, setChampionOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const { copy } = useCopyInvite(tournamentId, tournamentLink(tournamentId));
  const onError = useCallback((m: string) => toast(m, 'error'), [toast]);
  const { create, creating } = useCreateTournament(onError);

  const { t, me, phase, error, connected, actions } = useTournament(tournamentId, {
    onKicked: () => toast('Chủ giải đã mời bạn ra khỏi giải. Bạn vẫn có thể xem.', 'warning'),
  });
  const { myMatch, go } = useMatchLauncher(t, me);
  const myId = me.participantId;
  const isParticipant = !!t && !!myId && t.participants.some((p) => p.id === myId);

  // Join sound + toast when someone takes a seat in the lobby.
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!t || t.status !== 'LOBBY') return;
    const ids = new Set(t.participants.map((p) => p.id));
    if (seen.current) {
      const joined = t.participants.filter((p) => !seen.current!.has(p.id) && p.id !== myId);
      if (joined.length) {
        sfx.join();
        toast(`${joined[0].name} đã vào giải`, 'success');
      }
    }
    seen.current = ids;
  }, [t, myId, toast]);

  // Kick-off.
  const prevStatus = useRef<string | null>(null);
  useEffect(() => {
    if (!t) return;
    if (prevStatus.current === 'LOBBY' && t.status === 'RUNNING') {
      sfx.countdown(true);
      toast('Giải đấu bắt đầu! Bracket đã được bốc thăm.', 'success');
    }
    // Champion screen: when it happens live, or on first view of a finished tournament.
    if (t.status === 'FINISHED' && prevStatus.current !== 'FINISHED') setChampionOpen(true);
    prevStatus.current = t.status;
  }, [t, toast]);

  useEffect(() => {
    document.title = t ? `${t.name} — Caro Online` : 'Giải đấu — Caro Online';
    return () => {
      document.title = 'Caro Online';
    };
  }, [t]);

  if (phase !== 'ready' || !t) {
    return (
      <Shell>
        <PhaseScreen phase={phase} error={error} onRetry={actions.retry} />
      </Shell>
    );
  }

  const join = async (name: string) => {
    const res = await actions.join(name);
    if (!res.ok) toast(res.message, 'error');
    else sfx.join();
  };
  const start = async () => {
    const res = await actions.start();
    if (!res.ok) toast(res.message, 'error');
  };
  const kick = async (id: string) => {
    const res = await actions.kick(id);
    if (!res.ok) toast(res.message, 'error');
  };
  const changeAvatar = async (avatar: string) => {
    const res = await actions.setAvatar(avatar);
    if (!res.ok) {
      toast(res.message, 'error');
      return false;
    }
    setMyAvatar(avatar);
    return true;
  };
  const leave = async () => {
    setConfirmLeave(false);
    if (isParticipant) await actions.leave();
    navigate('/');
  };
  const watch = (roomId: string) => navigate(`/game/${roomId}`);
  const stillPlaying = isParticipant && t.status === 'RUNNING' && !!myMatch;

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-[1400px] items-center justify-between gap-2 px-3 py-2.5 sm:px-5 sm:py-3">
        <div className="flex min-w-0 items-center gap-2 sm:gap-4">
          <Logo responsive />
          <button
            type="button"
            onClick={copy}
            title="Sao chép link giải đấu"
            className="group inline-flex min-w-0 items-center gap-1.5 rounded-xl bg-white/80 px-2.5 py-1.5 text-xs font-bold text-slate-500 shadow-soft ring-1 ring-slate-200/80 transition-all hover:-translate-y-0.5 hover:text-brand-600 sm:text-sm"
          >
            <Trophy className="h-4 w-4 shrink-0" />
            <span className="font-display tracking-wider text-brand-600">{t.id}</span>
            <CopyIcon size={14} className="opacity-50 group-hover:opacity-100" />
          </button>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2">
          <SpectatorPill count={t.spectatorCount} className="hidden sm:inline-flex" />
          <span className={cx('h-2.5 w-2.5 rounded-full', connected ? 'bg-emerald-400' : 'animate-pulse bg-orange-400')} title={connected ? 'Đã kết nối' : 'Đang kết nối lại…'} />
          <AccountMenu compact />
          <IconButton label={soundOn ? 'Tắt âm thanh' : 'Bật âm thanh'} onClick={() => setSoundOn(!soundOn)} active={soundOn}>
            {soundOn ? <VolumeOnIcon size={18} /> : <VolumeOffIcon size={18} />}
          </IconButton>
          <Button
            variant="secondary"
            size="sm"
            className="h-10"
            icon={<LogOutIcon size={17} />}
            onClick={() => (stillPlaying || (isParticipant && t.status === 'LOBBY') ? setConfirmLeave(true) : void leave())}
          >
            <span className="hidden sm:inline">{isParticipant && t.status !== 'FINISHED' ? 'Rời giải' : 'Về sảnh'}</span>
          </Button>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-4 px-3 pb-8 sm:gap-5 sm:px-5">
        {!connected && (
          <div className="animate-fade-up rounded-2xl bg-orange-50 px-4 py-2 text-center text-sm font-semibold text-orange-700 ring-1 ring-orange-200">
            Mất kết nối — đang kết nối lại…
          </div>
        )}
        <TournamentHero t={t} />

        {t.status === 'LOBBY' ? (
          <TournamentLobby t={t} myId={myId} onJoin={join} onStart={start} onKick={kick} onChangeAvatar={changeAvatar} />
        ) : (
          <>
            <div className="grid gap-4 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] lg:items-start">
              <MyJourney t={t} myId={isParticipant ? myId : null} onPlay={go} onWatch={watch} />
              <LiveStrip t={t} myId={myId} onWatch={watch} />
            </div>
            <Card className="p-3 pt-4 sm:p-5">
              <Bracket t={t} myId={isParticipant ? myId : null} onWatch={watch} onPlay={go} />
            </Card>
          </>
        )}
      </main>

      {isParticipant && myMatch?.status === 'READY_CHECK' && (
        <ReadyCheckModal key={myMatch.id} t={t} match={myMatch} myId={myId!} onReady={() => actions.ready(myMatch.id)} />
      )}

      <ChampionModal
        open={championOpen}
        t={t}
        myId={isParticipant ? myId : null}
        onClose={() => setChampionOpen(false)}
        onHome={() => navigate('/')}
        onNew={() => {
          setChampionOpen(false);
          setSetupOpen(true);
        }}
      />

      <TournamentSetupModal
        open={setupOpen}
        loading={creating}
        boardSize={getSavedBoardSize()}
        turnSeconds={getSavedTurnSeconds()}
        onClose={() => setSetupOpen(false)}
        onStart={async (settings) => {
          if (await create(settings)) setSetupOpen(false);
        }}
      />

      <ConfirmDialog
        open={confirmLeave}
        title={t.status === 'LOBBY' ? 'Rời sảnh giải đấu?' : 'Rời giải đấu?'}
        message={
          t.status === 'LOBBY'
            ? 'Chỗ của bạn sẽ được nhường cho người khác.'
            : 'Bạn sẽ bị xử thua trận hiện tại và bị loại khỏi giải.'
        }
        confirmLabel="Rời giải"
        onConfirm={leave}
        onCancel={() => setConfirmLeave(false)}
      />
    </div>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-[1400px] items-center px-3 py-3 sm:px-5">
        <Logo />
      </header>
      <main className="flex flex-1 items-center justify-center p-4">{children}</main>
    </div>
  );
}

function PhaseScreen({ phase, error, onRetry }: { phase: string; error: string | null; onRetry: () => void }) {
  if (phase === 'connecting') {
    return (
      <Card className="animate-fade-up flex w-full max-w-sm flex-col items-center p-8 text-center">
        <Trophy className="t-bob h-14 w-14" />
        <Spinner className="mt-4 h-6 w-6 border-[3px] text-brand-500" />
        <h1 className="mt-3 font-display text-xl font-bold text-slate-800">Đang vào giải đấu</h1>
        <p className="mt-1 text-sm text-slate-500">Đang kết nối tới máy chủ…</p>
      </Card>
    );
  }
  const screens: Record<string, { title: string; text: string; retry?: boolean }> = {
    'not-found': { title: 'Không tìm thấy giải đấu', text: 'Giải này không tồn tại hoặc đã hết hạn. Hãy xin link mới hoặc tự tạo một giải.' },
    closed: { title: 'Giải đấu đã đóng', text: 'Mọi người đã rời đi nên giải đấu đã được đóng.' },
    error: { title: 'Lỗi kết nối', text: error ?? 'Không thể kết nối tới máy chủ trò chơi.', retry: true },
  };
  const s = screens[phase] ?? screens.error;
  return (
    <Card className="animate-fade-up w-full max-w-sm p-8 text-center">
      <Trophy className="mx-auto mb-4 h-16 w-16 opacity-50 grayscale" />
      <h1 className="font-display text-2xl font-bold text-slate-800">{s.title}</h1>
      <p className="mt-2 text-sm text-slate-500">{s.text}</p>
      <div className="mt-6 flex flex-col gap-2">
        {s.retry && (
          <Button variant="primary" onClick={onRetry}>
            Thử lại
          </Button>
        )}
        <Link
          to="/"
          className="inline-flex h-11 items-center justify-center rounded-2xl bg-white font-display font-semibold text-slate-700 shadow-soft ring-1 ring-slate-200 transition-all hover:-translate-y-0.5 hover:text-brand-600"
        >
          Về sảnh
        </Link>
      </div>
    </Card>
  );
}
