import type { ReactNode } from 'react';
import { cx } from '../../lib/cx';
import type { PublicMatch, TournamentSnapshot } from '../../lib/protocol';
import { activeMatchOf, bestOfHint, currentRound, opponentIn, participantMap, reachedRound, roundName, roundShort } from '../../lib/tournament';
import { AvatarWithFrame } from '../AvatarWithFrame';
import { PlayerName } from '../PlayerName';
import { ArrowRightIcon, CheckIcon, EyeIcon, TimerIcon, UsersIcon } from '../icons';
import { Button, Card, LoadingDots } from '../ui';
import { Crown, Face, LiveDot, Trophy, useCountdown } from './parts';

/** Banner at the top of the tournament page: name, settings, and the road to the final. */
export function TournamentHero({ t }: { t: TournamentSnapshot }) {
  const live = t.rounds.flat().filter((m) => m.status === 'LIVE').length;
  const cur = currentRound(t);
  return (
    <section className="t-hero-dots animate-fade-up relative overflow-hidden rounded-[28px] bg-gradient-to-br from-violet-500 via-brand-500 to-sky-400 px-5 py-5 text-white shadow-lift sm:px-7 sm:py-6">
      <div className="absolute -right-8 -bottom-14 h-48 w-48 rounded-full bg-amber-300/30 blur-3xl" aria-hidden="true" />
      <div className="relative flex items-center gap-4">
        <div className="t-shine hidden h-20 w-20 shrink-0 place-items-center rounded-3xl bg-white/20 ring-1 ring-white/40 backdrop-blur sm:grid">
          <Trophy className="t-bob h-14 w-14 drop-shadow-[0_6px_10px_rgb(30_27_75/0.35)]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusBadge t={t} />
            {live > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-500 px-2.5 py-0.5 text-[11px] font-extrabold tracking-wide uppercase shadow-sm">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" /> {live} trận live
              </span>
            )}
          </div>
          <h1 className="mt-1 truncate font-display text-2xl leading-tight font-bold drop-shadow-sm sm:text-4xl">{t.name}</h1>
          <div className="mt-1.5 flex flex-wrap gap-1.5 text-xs font-bold">
            <Meta>
              <UsersIcon size={13} /> {t.status === 'LOBBY' ? `${t.participants.length}/${t.size}` : t.size} người
            </Meta>
            <Meta>
              Bàn {t.config.boardSize}×{t.config.boardSize}
            </Meta>
            <Meta>
              <TimerIcon size={13} /> {Math.round(t.config.turnMs / 1000)}s/lượt
            </Meta>
            <Meta>
              <span title={bestOfHint(t.config.bestOf)}>BO{t.config.bestOf}</span>
              <span className="hidden font-semibold text-white/80 sm:inline">· {bestOfHint(t.config.bestOf)}</span>
            </Meta>
          </div>
        </div>
      </div>

      {t.status !== 'LOBBY' && t.rounds.length > 0 && (
        <ol className="relative mt-5 flex items-center gap-1 sm:gap-2" aria-label="Tiến trình giải">
          {t.rounds.map((_, r) => {
            const done = t.status === 'FINISHED' || r < cur;
            const now = t.status === 'RUNNING' && r === cur;
            return (
              <li key={r} className="flex min-w-0 flex-1 items-center gap-1 sm:gap-2">
                <span
                  className={cx(
                    'flex min-w-0 flex-1 items-center justify-center gap-1 rounded-full px-2 py-1 text-[11px] font-extrabold whitespace-nowrap transition-colors sm:text-xs',
                    done ? 'bg-white/90 text-brand-600' : now ? 'animate-pulse-soft bg-amber-300 text-amber-900 shadow-md' : 'bg-white/15 text-white/70',
                  )}
                >
                  {done && <CheckIcon size={12} strokeWidth={3} />}
                  <span className="truncate sm:hidden">{roundShort(r, t.rounds.length)}</span>
                  <span className="hidden truncate sm:inline">{roundName(r, t.rounds.length)}</span>
                </span>
                <span className={cx('h-0.5 w-2 shrink-0 rounded-full sm:w-4', done ? 'bg-white/80' : 'bg-white/25')} />
              </li>
            );
          })}
          <li className={cx('grid h-8 w-8 shrink-0 place-items-center rounded-full', t.status === 'FINISHED' ? 't-shine bg-amber-300' : 'bg-white/15')}>
            <Trophy className={cx('h-5 w-5', t.status !== 'FINISHED' && 'opacity-60')} />
          </li>
        </ol>
      )}
    </section>
  );
}

function StatusBadge({ t }: { t: TournamentSnapshot }) {
  const label = t.status === 'LOBBY' ? 'Đang mở đăng ký' : t.status === 'RUNNING' ? 'Đang thi đấu' : 'Đã kết thúc';
  return (
    <span
      className={cx(
        'rounded-full px-2.5 py-0.5 text-[11px] font-extrabold tracking-wide uppercase ring-1',
        t.status === 'FINISHED' ? 'bg-amber-300 text-amber-900 ring-amber-200' : 'bg-white/20 ring-white/30',
      )}
    >
      {label}
    </span>
  );
}

function Meta({ children }: { children: ReactNode }) {
  return <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 ring-1 ring-white/25">{children}</span>;
}

interface JourneyProps {
  t: TournamentSnapshot;
  myId: string | null;
  onPlay: (roomId: string) => void;
  onWatch: (roomId: string) => void;
}

/** "Your next match" for players; a short guide for spectators. */
export function MyJourney({ t, myId, onPlay, onWatch }: JourneyProps) {
  const players = participantMap(t);
  const me = myId ? players.get(myId) : undefined;
  const liveMatches = t.rounds.flat().filter((m) => m.status === 'LIVE');

  if (!me) {
    return (
      <Card className="flex items-center gap-3 p-4">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-violet-50 text-violet-500">
          <EyeIcon size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-display text-base font-bold text-slate-800">Bạn đang xem giải đấu</div>
          <p className="text-sm text-slate-500">
            {liveMatches.length ? 'Bấm “Xem trực tiếp” trên thẻ trận đấu để vào khán đài.' : 'Bracket cập nhật trực tiếp theo từng trận.'}
          </p>
        </div>
        {liveMatches[0]?.roomId && (
          <Button variant="secondary" size="sm" className="h-10 shrink-0" icon={<EyeIcon size={16} />} onClick={() => onWatch(liveMatches[0].roomId!)}>
            Xem
          </Button>
        )}
      </Card>
    );
  }

  if (t.championId === me.id) {
    return (
      <Card className="t-shine flex items-center gap-3 bg-gradient-to-r from-amber-50 to-orange-50 p-4 ring-amber-200">
        <Trophy className="h-12 w-12 shrink-0" />
        <div>
          <div className="font-display text-lg font-bold text-amber-800">Bạn là nhà vô địch!</div>
          <p className="text-sm font-semibold text-amber-700/80">Bất bại suốt giải — một chiếc cúp thật xứng đáng.</p>
        </div>
      </Card>
    );
  }

  const m = activeMatchOf(t, me.id);
  if (!m) {
    const reached = reachedRound(t, me.id);
    const runnerUp = !me.left && reached === t.rounds.length - 1;
    return (
      <Card className={cx('flex items-center gap-3 p-4', runnerUp && 'bg-gradient-to-r from-slate-50 to-white')}>
        <Face p={me} className="h-11 w-11" dot={false} />
        <div className="min-w-0 flex-1">
          <div className="font-display text-base font-bold text-slate-800">
            {me.left
              ? 'Bạn đã rời giải'
              : runnerUp
                ? 'Bạn là Á quân!'
                : `Bạn dừng bước ở ${roundName(Math.max(0, reached), t.rounds.length).toLowerCase()}`}
          </div>
          <p className="text-sm text-slate-500">
            {t.status === 'FINISHED' ? 'Giải đấu đã khép lại. Hẹn gặp ở giải sau!' : 'Ở lại cổ vũ nhé — bạn có thể xem trực tiếp các trận còn lại.'}
          </p>
        </div>
      </Card>
    );
  }

  return <NextMatch t={t} m={m} myId={me.id} onPlay={onPlay} />;
}

function NextMatch({ t, m, myId, onPlay }: { t: TournamentSnapshot; m: PublicMatch; myId: string; onPlay: (roomId: string) => void }) {
  const players = participantMap(t);
  const me = players.get(myId)!;
  const oppId = opponentIn(m, myId);
  const opp = oppId ? players.get(oppId) : undefined;
  const secs = useCountdown(m.status === 'READY_CHECK' ? m.readyDeadline : null);
  // Who could still come out of the feeder match, while the opponent isn't known.
  const feeder = !opp && m.round > 0 ? t.rounds[m.round - 1][m.index * 2 + (m.playerA === myId ? 1 : 0)] : undefined;
  const feederNames = feeder ? [feeder.playerA, feeder.playerB].map((id) => (id ? players.get(id)?.name : null)).filter(Boolean) : [];

  return (
    <Card
      className={cx(
        'relative overflow-hidden p-4 sm:p-5',
        m.status === 'LIVE' && 'ring-2 ring-rose-300',
        m.status === 'READY_CHECK' && 'ring-2 ring-amber-300',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-extrabold tracking-wide text-slate-400 uppercase">
          Trận tiếp theo · <span className="text-brand-600">{roundName(m.round, t.rounds.length)}</span>
        </span>
        {m.status === 'LIVE' && (
          <span className="inline-flex items-center gap-1.5 text-xs font-extrabold text-rose-600 uppercase">
            <LiveDot /> Đang diễn ra
          </span>
        )}
        {m.status === 'READY_CHECK' && <span className="tabular text-xs font-extrabold text-amber-600 uppercase">Xác nhận · {secs}s</span>}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <AvatarWithFrame avatar={me.avatar} frameId={me.avatarFrame} seed={me.id} name={me.name} className="h-12 w-12 rounded-2xl bg-brand-50 ring-2 ring-brand-300" />
          <div className="min-w-0">
            <PlayerName as="div" name={me.name} nameStyle={me.nameStyle} className="truncate font-display font-bold text-slate-800" />
            <div className="text-xs font-bold text-brand-500">Bạn</div>
          </div>
        </div>
        {t.config.bestOf > 1 && m.status === 'LIVE' ? (
          <span className="tabular shrink-0 text-center">
            <span className="block font-display text-2xl leading-none font-extrabold text-slate-800">
              {m.playerA === myId ? m.scoreA : m.scoreB}
              <span className="mx-1 text-slate-300">–</span>
              {m.playerA === myId ? m.scoreB : m.scoreA}
            </span>
            <span className="text-[10px] font-extrabold text-violet-500">BO{t.config.bestOf}</span>
          </span>
        ) : (
          <span className="font-display text-lg font-extrabold text-coral-500">VS</span>
        )}
        <div className="flex min-w-0 flex-1 flex-row-reverse items-center gap-2.5 text-right">
          {opp ? (
            <>
              <AvatarWithFrame avatar={opp.avatar} frameId={opp.avatarFrame} seed={opp.id} name={opp.name} className="h-12 w-12 rounded-2xl bg-coral-50 ring-2 ring-coral-200" />
              <div className="min-w-0">
                <PlayerName as="div" name={opp.name} nameStyle={opp.nameStyle} className="truncate font-display font-bold text-slate-800" />
                <div className="text-xs font-bold text-slate-400">Hạt giống #{opp.seed}</div>
              </div>
            </>
          ) : (
            <>
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border-2 border-dashed border-slate-200 font-display text-lg font-bold text-slate-300">?</span>
              <div className="min-w-0">
                <div className="font-display font-bold text-slate-500">Chờ đối thủ</div>
                <div className="truncate text-xs font-semibold text-slate-400">{feederNames.length === 2 ? feederNames.join(' hoặc ') : 'Đang xác định'}</div>
              </div>
            </>
          )}
        </div>
      </div>

      {m.status === 'LIVE' && m.roomId && (
        <Button variant="primary" size="lg" className="mt-4 w-full animate-pulse-soft" icon={<ArrowRightIcon size={20} />} onClick={() => onPlay(m.roomId!)}>
          {m.nextGameAt ? `Ván ${m.games + 1} sắp bắt đầu — vào trận` : 'Vào trận ngay'}
        </Button>
      )}
      {m.status === 'PENDING' && (
        <p className="mt-3 flex items-center justify-center gap-1.5 rounded-xl bg-slate-50 py-2 text-sm font-semibold text-slate-500">
          Trận sẽ mở khi có đối thủ <LoadingDots className="text-slate-400" />
        </p>
      )}
      {m.round === 1 && t.rounds[0].some((x) => x.reason === 'bye' && x.winnerId === myId) && (
        <p className="mt-2 flex items-center justify-center gap-1 text-xs font-semibold text-amber-600">
          <Crown className="h-4 w-4" /> Hạt giống #{me.seed} — bạn được miễn đấu vòng đầu
        </p>
      )}
    </Card>
  );
}

/** Horizontal strip of matches being played right now, for quick spectating. */
export function LiveStrip({ t, myId, onWatch }: { t: TournamentSnapshot; myId: string | null; onWatch: (roomId: string) => void }) {
  const players = participantMap(t);
  const live = t.rounds.flat().filter((m) => m.status === 'LIVE' && m.roomId && m.playerA !== myId && m.playerB !== myId);
  if (!live.length) return null;
  return (
    <div className="animate-fade-up">
      <h3 className="mb-2 flex items-center gap-2 font-display text-sm font-bold text-slate-600">
        <LiveDot /> Đang diễn ra
      </h3>
      <div className="board-scroll -mx-3 flex gap-2.5 overflow-x-auto px-3 pb-1 sm:-mx-5 sm:px-5">
        {live.map((m) => {
          const a = players.get(m.playerA!);
          const b = players.get(m.playerB!);
          if (!a || !b) return null;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => onWatch(m.roomId!)}
              className="group flex shrink-0 items-center gap-2 rounded-2xl bg-white py-2 pr-3 pl-2 shadow-soft ring-1 ring-rose-200 transition-all hover:-translate-y-0.5 hover:ring-rose-300"
            >
              <Face p={a} className="h-8 w-8" dot={false} />
              <span className="font-display text-xs font-extrabold text-rose-400">VS</span>
              <Face p={b} className="h-8 w-8" dot={false} />
              <span className="ml-1 text-left">
                <span className="block max-w-32 truncate text-xs font-bold text-slate-700">
                  {a.name} · {b.name}
                </span>
                <span className="block text-[10px] font-bold text-slate-400">{roundName(m.round, t.rounds.length)}</span>
              </span>
              <span className="ml-1 grid h-7 w-7 place-items-center rounded-lg bg-rose-50 text-rose-500 transition-colors group-hover:bg-rose-500 group-hover:text-white">
                <EyeIcon size={15} />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
