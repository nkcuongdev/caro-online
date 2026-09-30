import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { cx } from '../../lib/cx';
import type { PublicMatch, PublicParticipant, TournamentSnapshot } from '../../lib/protocol';
import { sfx } from '../../lib/sound';
import { bestOfHint, roundName } from '../../lib/tournament';
import { AvatarWithFrame } from '../AvatarWithFrame';
import { PlayerName } from '../PlayerName';
import { CheckIcon, ZapIcon } from '../icons';
import { Button, LoadingDots } from '../ui';
import { TitleBadge } from '../titles/TitleBadge';
import { SeedBadge, Trophy, useCountdown } from './parts';

interface ReadyCheckProps {
  t: TournamentSnapshot;
  match: PublicMatch;
  myId: string;
  onReady: () => Promise<{ ok: boolean; message?: string }>;
}

/** "Match found" screen. Both players confirm before the server opens the match room. */
export function ReadyCheckModal({ t, match, myId, onReady }: ReadyCheckProps) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const secs = useCountdown(match.readyDeadline);
  const total = Math.round(t.config.readyCheckMs / 1000);
  const me = t.participants.find((p) => p.id === myId)!;
  const oppId = match.playerA === myId ? match.playerB : match.playerA;
  const opp = t.participants.find((p) => p.id === oppId) ?? null;
  const iReady = match.ready.includes(myId);
  const theyReady = !!oppId && match.ready.includes(oppId);
  const isFinal = match.round === t.rounds.length - 1;

  useEffect(() => {
    sfx.readyCheck();
    const original = document.title;
    let flip = false;
    const id = window.setInterval(() => {
      flip = !flip;
      document.title = flip ? '⚔️ Trận đấu đã sẵn sàng!' : original;
    }, 900);
    return () => {
      window.clearInterval(id);
      document.title = original;
    };
  }, [match.id]);

  // Last seconds tick, only while we still have to answer.
  useEffect(() => {
    if (!iReady && secs > 0 && secs <= 5) sfx.tick(secs <= 3);
  }, [secs, iReady]);

  const confirm = async () => {
    setSending(true);
    setError(null);
    const res = await onReady();
    setSending(false);
    if (!res.ok) setError(res.message ?? 'Không gửi được, hãy thử lại.');
  };

  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const fraction = total > 0 ? Math.min(1, secs / total) : 0;
  const urgent = secs <= 5;

  return createPortal(
    // Above other dialogs (e.g. the previous game's result): it's on a clock. Toasts (z-60) stay on top.
    <div className="fixed inset-0 z-[55] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="ready-title">
      <div className="animate-fade-in absolute inset-0 bg-gradient-to-br from-violet-900/55 via-brand-900/50 to-slate-900/60 backdrop-blur-[4px]" />
      <div className="animate-pop-in relative w-full max-w-md overflow-hidden rounded-[32px] bg-white shadow-[0_30px_80px_-20px_rgb(15_23_42/0.6)] ring-1 ring-white/60">
        <div
          className={cx(
            't-hero-dots relative px-6 pt-6 pb-16 text-center text-white',
            isFinal ? 'bg-gradient-to-br from-amber-400 via-orange-400 to-rose-400' : 'bg-gradient-to-br from-violet-500 via-brand-500 to-sky-400',
          )}
        >
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1 text-xs font-extrabold tracking-wide uppercase ring-1 ring-white/30">
            {isFinal ? <Trophy className="h-4 w-4" /> : <ZapIcon size={13} />} {roundName(match.round, t.rounds.length)}
          </span>
          {t.config.bestOf > 1 && (
            <span className="ml-1.5 inline-flex items-center rounded-full bg-white/90 px-2.5 py-1 text-xs font-extrabold text-violet-600 shadow-sm">
              BO{t.config.bestOf} · {bestOfHint(t.config.bestOf)}
            </span>
          )}
          <h2 id="ready-title" className="mt-2 font-display text-3xl leading-tight font-bold drop-shadow-sm">
            Trận đấu đã sẵn sàng!
          </h2>
          <p className="mt-0.5 text-sm font-semibold text-white/85">Xác nhận để vào bàn cờ — ai vắng mặt sẽ bị xử thua.</p>
        </div>

        <div className="relative -mt-12 grid grid-cols-[1fr_auto_1fr] items-start gap-2 px-5">
          <Fighter p={me} ready={iReady} you className="t-slide-l" />
          <div className="t-slam mt-6 grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-coral-400 to-rose-500 font-display text-lg font-extrabold text-white shadow-[0_10px_20px_-8px_rgb(244_63_94/0.8)] ring-4 ring-white">
            VS
          </div>
          {opp ? <Fighter p={opp} ready={theyReady} className="t-slide-r" /> : <div />}
        </div>

        <div className="flex flex-col items-center px-6 pt-4 pb-6">
          <div className="relative grid h-20 w-20 place-items-center" role="timer" aria-label={`Còn ${secs} giây`}>
            <svg viewBox="0 0 80 80" className="absolute inset-0 -rotate-90">
              <circle cx="40" cy="40" r={radius} fill="none" stroke="rgb(241 245 249)" strokeWidth="7" />
              <circle
                cx="40"
                cy="40"
                r={radius}
                fill="none"
                stroke={urgent ? '#ef4444' : iReady ? '#10b981' : '#f59e0b'}
                strokeWidth="7"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={circumference * (1 - fraction)}
                className="transition-[stroke-dashoffset,stroke] duration-300 ease-linear"
              />
            </svg>
            <span className={cx('tabular font-display text-3xl font-bold', urgent ? 'animate-pulse-soft text-red-500' : 'text-slate-700')}>{secs}</span>
          </div>

          {iReady ? (
            <div className="mt-4 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-50 font-display font-bold text-emerald-700 ring-1 ring-emerald-200">
              <CheckIcon size={20} />
              {theyReady ? 'Cả hai đã sẵn sàng — vào trận!' : 'Đã sẵn sàng · chờ đối thủ'}
              {!theyReady && <LoadingDots className="text-emerald-500" />}
            </div>
          ) : (
            <Button
              variant="success"
              size="lg"
              className={cx('mt-4 w-full text-xl tracking-wide', !sending && 'animate-pulse-soft')}
              loading={sending}
              icon={!sending && <CheckIcon size={22} />}
              onClick={confirm}
              data-autofocus
            >
              SẴN SÀNG!
            </Button>
          )}
          {error && <p className="mt-2 text-sm font-semibold text-red-500">{error}</p>}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Fighter({ p, ready, you, className }: { p: PublicParticipant; ready: boolean; you?: boolean; className?: string }) {
  return (
    <div className={cx('flex min-w-0 flex-col items-center text-center', className)}>
      <div className="relative">
        <AvatarWithFrame
          avatar={p.avatar}
          frameId={p.avatarFrame}
          seed={p.id}
          name={p.name}
          className={cx(
            'h-20 w-20 rounded-3xl bg-brand-50 shadow-lift ring-4 transition-[box-shadow,--tw-ring-color] duration-300',
            ready ? 'ring-emerald-400' : 'ring-white',
          )}
        />
        {ready && (
          <span className="absolute -right-2 -bottom-2 grid h-8 w-8 animate-pop-in place-items-center rounded-full bg-emerald-500 text-white shadow-md ring-[3px] ring-white">
            <CheckIcon size={16} strokeWidth={3} />
          </span>
        )}
      </div>
      <div className="mt-2 flex max-w-full items-center gap-1">
        <PlayerName name={p.name} nameStyle={p.nameStyle} className="truncate font-display text-base font-bold text-slate-800" />
        <SeedBadge seed={p.seed} />
      </div>
      {p.title && <TitleBadge title={p.title} size="sm" className="mb-0.5" />}
      <span className={cx('text-xs font-bold', ready ? 'text-emerald-600' : 'text-slate-400')}>
        {you ? 'Bạn' : ready ? 'Sẵn sàng!' : p.online ? 'Đang xác nhận…' : 'Chưa có mặt'}
      </span>
    </div>
  );
}
