import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { cx } from '../../lib/cx';
import type { PublicMatch, PublicParticipant, TournamentSnapshot } from '../../lib/protocol';
import { sfx } from '../../lib/sound';
import { currentRound, participantMap, roundName } from '../../lib/tournament';
import { AvatarWithFrame } from '../AvatarWithFrame';
import { PlayerName } from '../PlayerName';
import { ArrowRightIcon, CheckIcon, EyeIcon } from '../icons';
import { Crown, Face, MatchStatusChip, SeedBadge, Trophy } from './parts';

/** Horizontal space between rounds; the connectors are drawn inside it. */
const GAP = 44;

interface BracketProps {
  t: TournamentSnapshot;
  myId: string | null;
  onWatch: (roomId: string) => void;
  onPlay: (roomId: string) => void;
  className?: string;
}

/**
 * The bracket as a CSS grid: one column per round, one row per first-round
 * match. Match i of round r spans 2^r rows, so it sits exactly between the two
 * matches that feed it, and the connectors are just half-height lines.
 */
export function Bracket({ t, myId, onWatch, onPlay, className }: BracketProps) {
  const players = useMemo(() => participantMap(t), [t]);
  const rounds = t.rounds.length;
  const firstRound = t.rounds[0]?.length ?? 0;
  const live = currentRound(t);
  const fx = useBracketFx(t);
  const scroller = useRef<HTMLDivElement>(null);
  const phone = useMediaQuery('(max-width: 639px)');

  // Keep the round being played in view on narrow screens.
  useEffect(() => {
    const el = scroller.current?.querySelector<HTMLElement>(`[data-round="${live}"]`);
    if (el && scroller.current && scroller.current.scrollWidth > scroller.current.clientWidth) {
      scroller.current.scrollTo({ left: Math.max(0, el.offsetLeft - 16), behavior: 'smooth' });
    }
  }, [live]);

  if (!rounds) return null;
  if (phone) return <RoundTabs t={t} players={players} myId={myId} fx={fx} onWatch={onWatch} onPlay={onPlay} className={className} />;

  const columns: CSSProperties = {
    gridTemplateColumns: `repeat(${rounds}, var(--col)) var(--champ)`,
    columnGap: GAP,
    ['--col' as string]: 'clamp(208px, 62vw, 236px)',
    ['--champ' as string]: '176px',
  };

  return (
    <div ref={scroller} className={cx('t-bracket-scroll -mx-3 overflow-x-auto px-3 pt-1 pb-4 sm:-mx-5 sm:px-5', className)}>
      <div className="mx-auto grid w-max" style={columns}>
        {t.rounds.map((round, r) => (
          <div key={r} data-round={r} className="mb-3 flex snap-start items-center justify-center">
            <span
              className={cx(
                'inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-display text-sm font-bold whitespace-nowrap',
                r === live && t.status === 'RUNNING'
                  ? 'bg-brand-500 text-white shadow-[0_6px_14px_-6px_rgb(37_99_235/0.6)]'
                  : round.every((m) => m.status === 'DONE')
                    ? 'bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200'
                    : 'bg-white/80 text-slate-500 ring-1 ring-slate-200',
              )}
            >
              {round.every((m) => m.status === 'DONE') && <CheckIcon size={14} />}
              {roundName(r, rounds)}
            </span>
          </div>
        ))}
        <div className="mb-3 flex items-center justify-center">
          <span className="rounded-full bg-amber-100 px-3 py-1 font-display text-sm font-bold text-amber-700 ring-1 ring-amber-200">Vô địch</span>
        </div>
      </div>

      <div className="mx-auto grid w-max" style={{ ...columns, gridTemplateRows: `repeat(${firstRound}, minmax(132px, auto))` }}>
        {t.rounds.map((round, r) =>
          round.map((m) => (
            <div
              key={m.id}
              className="relative flex items-center py-2"
              style={{ gridColumn: r + 1, gridRow: `${m.index * 2 ** r + 1} / span ${2 ** r}` }}
            >
              {r > 0 && <Stub side="left" lit={isFed(t, m)} />}
              {r < rounds - 1 && <Connector down={m.index % 2 === 0} lit={m.status === 'DONE'} fresh={fx.done.has(m.id)} />}
              {r === rounds - 1 && <Stub side="right" lit={m.status === 'DONE'} fresh={fx.done.has(m.id)} long />}
              <MatchCard
                match={m}
                players={players}
                isFinal={r === rounds - 1}
                bestOf={t.config.bestOf}
                myId={myId}
                freshSlots={fx.slots}
                onWatch={onWatch}
                onPlay={onPlay}
              />
            </div>
          )),
        )}
        <div className="flex items-center justify-center" style={{ gridColumn: rounds + 1, gridRow: `1 / span ${firstRound}` }}>
          <ChampionSlot champion={t.championId ? (players.get(t.championId) ?? null) : null} fresh={fx.champion} />
        </div>
      </div>
    </div>
  );
}

type BracketFx = ReturnType<typeof useBracketFx>;

/**
 * Phones: a tall tree leaves later rounds far below the fold, so show one
 * round at a time. The round pills double as the progress bar, and each card
 * says where its winner goes next.
 */
function RoundTabs({
  t,
  players,
  myId,
  fx,
  onWatch,
  onPlay,
  className,
}: {
  t: TournamentSnapshot;
  players: Map<string, PublicParticipant>;
  myId: string | null;
  fx: BracketFx;
  onWatch: (roomId: string) => void;
  onPlay: (roomId: string) => void;
  className?: string;
}) {
  const rounds = t.rounds.length;
  const live = currentRound(t);
  const championTab = rounds;
  const [picked, setPicked] = useState<number | null>(null);
  // Follow the bracket as it moves on, unless the viewer picked a round themselves.
  const tab = picked ?? (t.status === 'FINISHED' ? championTab : live);
  const pills = useRef<HTMLDivElement>(null);
  useEffect(() => {
    pills.current?.querySelector<HTMLElement>(`[data-tab="${tab}"]`)?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [tab]);

  return (
    <div className={className}>
      <div ref={pills} role="tablist" aria-label="Vòng đấu" className="board-scroll -mx-3 flex gap-1.5 overflow-x-auto px-3 pb-3">
        {t.rounds.map((round, r) => {
          const done = round.every((m) => m.status === 'DONE');
          const hasLive = round.some((m) => m.status === 'LIVE');
          return (
            <button
              key={r}
              type="button"
              role="tab"
              data-tab={r}
              aria-selected={tab === r}
              onClick={() => setPicked(r)}
              className={cx(
                'inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 font-display text-sm font-bold whitespace-nowrap transition-colors',
                tab === r ? 'bg-brand-500 text-white shadow-[0_6px_14px_-6px_rgb(37_99_235/0.6)]' : done ? 'bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200' : 'bg-white text-slate-500 ring-1 ring-slate-200',
              )}
            >
              {done && <CheckIcon size={13} />}
              {hasLive && <span className={cx('h-1.5 w-1.5 animate-pulse rounded-full', tab === r ? 'bg-white' : 'bg-rose-500')} />}
              {roundName(r, rounds)}
            </button>
          );
        })}
        <button
          type="button"
          role="tab"
          data-tab={championTab}
          aria-selected={tab === championTab}
          onClick={() => setPicked(championTab)}
          className={cx(
            'inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 font-display text-sm font-bold whitespace-nowrap',
            tab === championTab ? 'bg-amber-400 text-white shadow-md' : 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
          )}
        >
          <Trophy className="h-4 w-4" /> Vô địch
        </button>
      </div>

      {tab === championTab ? (
        <div key="champ" className="animate-fade-up py-8">
          <ChampionSlot champion={t.championId ? (players.get(t.championId) ?? null) : null} fresh={fx.champion} />
        </div>
      ) : (
        <ul key={tab} className="animate-fade-up space-y-3">
          {t.rounds[tab].map((m) => (
            <li key={m.id}>
              <MatchCard match={m} players={players} isFinal={tab === rounds - 1} bestOf={t.config.bestOf} myId={myId} freshSlots={fx.slots} onWatch={onWatch} onPlay={onPlay} />
              {tab < rounds - 1 && (
                <p className={cx('mt-1 flex items-center justify-end gap-1 pr-2 text-[11px] font-bold', m.status === 'DONE' ? 'text-amber-600' : 'text-slate-300')}>
                  Người thắng vào {roundName(tab + 1, rounds)} · {tab + 1 === rounds - 1 ? 'trận chung kết' : `Trận ${Math.floor(m.index / 2) + 1}`}
                  <ArrowRightIcon size={11} />
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A later-round match lights its incoming stub once either feeder is decided. */
function isFed(t: TournamentSnapshot, m: PublicMatch) {
  const prev = t.rounds[m.round - 1];
  return !!prev && (prev[m.index * 2]?.status === 'DONE' || prev[m.index * 2 + 1]?.status === 'DONE');
}

function Stub({ side, lit, fresh, long }: { side: 'left' | 'right'; lit: boolean; fresh?: boolean; long?: boolean }) {
  const width = long ? GAP : GAP / 2;
  return (
    <span className="pointer-events-none absolute top-1/2 h-0.5 -translate-y-1/2 bg-slate-200" style={{ width, [side === 'left' ? 'right' : 'left']: '100%' }}>
      {lit && <span className={cx('absolute inset-0 bg-gradient-to-r from-amber-300 to-amber-400', fresh && 't-connector-fill')} />}
    </span>
  );
}

/** Stub out of the card, then half the cell height towards the sibling match. */
function Connector({ down, lit, fresh }: { down: boolean; lit: boolean; fresh: boolean }) {
  return (
    <>
      <Stub side="right" lit={lit} fresh={fresh} />
      <span
        className="pointer-events-none absolute w-0.5 bg-slate-200"
        style={{ left: `calc(100% + ${GAP / 2 - 1}px)`, height: 'calc(50% + 1px)', ...(down ? { top: 'calc(50% - 1px)' } : { bottom: 'calc(50% - 1px)' }) }}
      >
        {lit && (
          <span
            className={cx('absolute inset-0 bg-amber-400', fresh && 't-connector-fill-y')}
            style={{ transformOrigin: down ? 'top' : 'bottom' }}
          />
        )}
      </span>
    </>
  );
}

interface MatchCardProps {
  match: PublicMatch;
  players: Map<string, PublicParticipant>;
  isFinal: boolean;
  bestOf: number;
  myId: string | null;
  freshSlots: Set<string>;
  onWatch: (roomId: string) => void;
  onPlay: (roomId: string) => void;
}

function MatchCard({ match: m, players, isFinal, bestOf, myId, freshSlots, onWatch, onPlay }: MatchCardProps) {
  const mine = !!myId && (m.playerA === myId || m.playerB === myId);
  const live = m.status === 'LIVE';
  // Series score once games have been played (not for byes or no-shows).
  const scored = bestOf > 1 && (live || (m.status === 'DONE' && m.games > 0));
  return (
    <article
      aria-label={isFinal ? 'Chung kết' : `Trận ${m.index + 1}`}
      className={cx(
        'relative w-full rounded-2xl bg-white transition-shadow',
        live ? 't-live-ring shadow-[0_14px_30px_-14px_rgb(244_63_94/0.55)]' : 'shadow-soft ring-1',
        !live && (mine ? 'ring-2 ring-brand-400' : isFinal ? 'ring-amber-300' : 'ring-slate-200/80'),
        m.status === 'READY_CHECK' && !mine && 'ring-amber-300',
      )}
    >
      <div className="relative rounded-2xl bg-white">
        <header
          className={cx(
            'flex items-center justify-between gap-2 rounded-t-2xl px-3 pt-2 pb-1',
            isFinal && 't-shine bg-gradient-to-r from-amber-100 via-amber-50 to-orange-100',
          )}
        >
          <span className={cx('font-display text-xs font-bold', isFinal ? 'text-amber-700' : 'text-slate-400')}>
            {isFinal ? (
              <span className="inline-flex items-center gap-1">
                <Trophy className="h-4 w-4" /> Chung kết
              </span>
            ) : (
              `Trận ${m.index + 1}`
            )}
            {live && (bestOf > 1 || m.games > 1) && <span className="ml-1 text-[10px] text-violet-500">· Ván {m.games}</span>}
          </span>
          <span className="flex items-center gap-1">
            {bestOf > 1 && <span className="rounded-md bg-violet-50 px-1.5 text-[10px] font-extrabold text-violet-500 ring-1 ring-violet-100">BO{bestOf}</span>}
            <MatchStatusChip match={m} />
          </span>
        </header>
        <div className="px-1.5 pb-1.5">
          <SlotRow match={m} slot="A" players={players} myId={myId} fresh={freshSlots.has(`${m.id}:A`)} score={scored ? m.scoreA : null} />
          <div className="mx-2 h-px bg-slate-100" />
          <SlotRow match={m} slot="B" players={players} myId={myId} fresh={freshSlots.has(`${m.id}:B`)} score={scored ? m.scoreB : null} />
        </div>
        {live && m.roomId && (
          <button
            type="button"
            onClick={() => (mine ? onPlay(m.roomId!) : onWatch(m.roomId!))}
            className={cx(
              'flex w-full items-center justify-center gap-1.5 rounded-b-2xl py-1.5 font-display text-xs font-bold transition-colors',
              mine ? 'bg-brand-500 text-white hover:bg-brand-600' : 'bg-rose-50 text-rose-600 hover:bg-rose-100',
            )}
          >
            {mine ? (
              <>
                Vào trận <ArrowRightIcon size={13} />
              </>
            ) : (
              <>
                <EyeIcon size={13} /> Xem trực tiếp
              </>
            )}
          </button>
        )}
      </div>
    </article>
  );
}

function SlotRow({
  match: m,
  slot,
  players,
  myId,
  fresh,
  score,
}: {
  match: PublicMatch;
  slot: 'A' | 'B';
  players: Map<string, PublicParticipant>;
  myId: string | null;
  fresh: boolean;
  /** Games won in a best-of series; null for single games. */
  score: number | null;
}) {
  const id = slot === 'A' ? m.playerA : m.playerB;
  const p = id ? players.get(id) : undefined;
  if (!p) {
    const bye = m.round === 0 && m.reason === 'bye';
    return (
      <div className="flex h-10 items-center gap-2 px-1.5">
        <span className="grid h-7 w-7 place-items-center rounded-xl border-2 border-dashed border-slate-200 text-[11px] font-bold text-slate-300">?</span>
        <span className="text-xs font-semibold text-slate-300 italic">{bye ? 'Miễn đấu' : 'Chờ người thắng'}</span>
      </div>
    );
  }
  const won = m.winnerId === p.id;
  const lost = m.status === 'DONE' && !!m.winnerId && !won;
  const isMe = p.id === myId;
  const ready = m.status === 'READY_CHECK' && m.ready.includes(p.id);
  return (
    <div
      className={cx(
        'flex h-10 items-center gap-2 rounded-xl px-1.5 transition-colors duration-500',
        fresh && 't-advance-in',
        won && 'bg-gradient-to-r from-amber-50 to-transparent',
        isMe && !won && 'bg-brand-50/70',
      )}
    >
      <Face p={p} className={cx('h-7 w-7', lost && 'opacity-50 grayscale')} />
      {/* Knocked-out players lose their style, so the bracket still reads at a glance. */}
      <PlayerName
        name={p.name}
        nameStyle={lost ? null : p.nameStyle}
        className={cx('min-w-0 flex-1 truncate text-sm font-bold', lost ? 'text-slate-400 line-through decoration-slate-300' : 'text-slate-700')}
      />
      {isMe && <span className="shrink-0 rounded-full bg-brand-100 px-1.5 text-[9px] font-extrabold text-brand-600 uppercase">Bạn</span>}
      <SeedBadge seed={p.seed} />
      {score !== null && (
        <span
          key={score}
          className={cx(
            'tabular grid h-6 min-w-6 shrink-0 animate-pop-in place-items-center rounded-lg px-1 font-display text-sm font-extrabold',
            won ? 'bg-amber-400 text-white' : lost ? 'bg-slate-100 text-slate-400' : 'bg-brand-50 text-brand-600 ring-1 ring-brand-100',
          )}
          title="Số ván thắng"
        >
          {score}
        </span>
      )}
      {won && score === null && (
        <span className="grid h-5 w-5 shrink-0 animate-pop-in place-items-center rounded-full bg-amber-400 text-white shadow-sm">
          <CheckIcon size={12} strokeWidth={3} />
        </span>
      )}
      {m.status === 'READY_CHECK' && (
        <span
          className={cx('grid h-5 w-5 shrink-0 place-items-center rounded-full', ready ? 'animate-pop-in bg-emerald-500 text-white' : 'bg-slate-100 text-slate-300')}
          title={ready ? 'Đã sẵn sàng' : 'Chưa sẵn sàng'}
        >
          <CheckIcon size={12} strokeWidth={3} />
        </span>
      )}
    </div>
  );
}

function ChampionSlot({ champion, fresh }: { champion: PublicParticipant | null; fresh: boolean }) {
  return (
    <div className={cx('relative flex w-full flex-col items-center text-center', fresh && 't-rise')}>
      {champion && <div className="t-rays absolute top-[-30px] left-1/2 h-48 w-48 -translate-x-1/2 rounded-full" aria-hidden="true" />}
      <div className="relative">
        {champion ? (
          <>
            <Crown className="absolute -top-5 left-1/2 z-10 h-7 w-7 -translate-x-1/2 t-bob" />
            <AvatarWithFrame
              avatar={champion.avatar}
              frameId={champion.avatarFrame}
              seed={champion.id}
              name={champion.name}
              className="h-20 w-20 rounded-3xl bg-amber-50 shadow-[0_14px_30px_-12px_rgb(245_158_11/0.8)] ring-4 ring-amber-300"
            />
          </>
        ) : (
          <div className="grid h-20 w-20 place-items-center rounded-3xl bg-white/80 shadow-soft ring-1 ring-amber-200">
            <Trophy className="h-12 w-12 opacity-40 grayscale-[0.3]" />
          </div>
        )}
      </div>
      <div className="relative mt-3 w-full">
        {champion ? (
          <>
            <PlayerName as="div" name={champion.name} nameStyle={champion.nameStyle} className="truncate font-display text-lg font-bold text-slate-800" />
            <div className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-amber-300 to-amber-500 px-2.5 py-0.5 text-[11px] font-extrabold tracking-wide text-white uppercase shadow-sm">
              <Trophy className="h-3.5 w-3.5" /> Vô địch
            </div>
          </>
        ) : (
          <div className="font-display text-sm font-bold text-slate-400">Ai sẽ lên ngôi?</div>
        )}
      </div>
    </div>
  );
}

/**
 * Remembers the previous snapshot to spot what just changed: slots that just
 * got a player (animate them sliding in), matches that just finished (fill
 * their connector) and a new champion. Effects fade after a moment.
 */
function useBracketFx(t: TournamentSnapshot) {
  const prev = useRef<TournamentSnapshot | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const [fx, setFx] = useState({ slots: new Set<string>(), done: new Set<string>(), champion: false });

  useEffect(() => () => window.clearTimeout(timer.current), []);

  useEffect(() => {
    const before = prev.current;
    prev.current = t;
    if (!before || before.id !== t.id || before.rounds.length !== t.rounds.length) return;
    const slots = new Set<string>();
    const done = new Set<string>();
    t.rounds.forEach((round, r) =>
      round.forEach((m, i) => {
        const old = before.rounds[r]?.[i];
        if (!old) return;
        if (r > 0 && m.playerA && !old.playerA) slots.add(`${m.id}:A`);
        if (r > 0 && m.playerB && !old.playerB) slots.add(`${m.id}:B`);
        if (m.status === 'DONE' && old.status !== 'DONE') done.add(m.id);
      }),
    );
    const champion = !!t.championId && !before.championId;
    if (!slots.size && !done.size && !champion) return;
    if (slots.size && !champion) sfx.advance();
    setFx({ slots, done, champion });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setFx({ slots: new Set(), done: new Set(), champion: false }), 2_000);
  }, [t]);

  return fx;
}
