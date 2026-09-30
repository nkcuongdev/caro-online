import type { ReactNode } from 'react';
import type { ModeStats, PlayerStats } from '../../lib/account';
import { cx } from '../../lib/cx';
import type { BotDifficulty, RoomMode } from '../../lib/protocol';
import { AvatarImage } from '../Avatar';
import { ClockIcon, FireIcon, GridIcon, StarIcon, ZapIcon } from '../icons';
import { Trophy } from '../tournament/parts';
import { BOT_LEVEL, formatPlayTime, MODE_LABEL, RESULT_STYLE } from './format';

const MODES: (RoomMode | null)[] = [null, 'pvp', 'bot', 'tournament'];

export function ModeTabs({ value, onChange }: { value: RoomMode | null; onChange: (m: RoomMode | null) => void }) {
  return (
    <div role="tablist" aria-label="Lọc theo chế độ" className="inline-flex max-w-full gap-1 overflow-x-auto rounded-2xl bg-white/80 p-1 shadow-soft ring-1 ring-slate-200/70">
      {MODES.map((m) => (
        <button
          key={m ?? 'all'}
          type="button"
          role="tab"
          aria-selected={value === m}
          onClick={() => onChange(m)}
          className={cx(
            'h-9 shrink-0 rounded-xl px-3.5 font-display text-sm font-semibold whitespace-nowrap transition-all',
            value === m ? 'bg-gradient-to-b from-brand-400 to-brand-600 text-white shadow-[0_6px_14px_-6px_rgb(37_99_235/0.6)]' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700',
          )}
        >
          {m ? MODE_LABEL[m] : 'Tất cả'}
        </button>
      ))}
    </div>
  );
}

/** Level badge + XP bar. */
export function LevelBar({ stats, className }: { stats: PlayerStats; className?: string }) {
  const span = Math.max(1, stats.nextLevelXp - stats.levelFloorXp);
  const pct = Math.min(100, Math.max(0, ((stats.xp - stats.levelFloorXp) / span) * 100));
  return (
    <div className={cx('rounded-2xl bg-white/90 p-3.5 ring-1 ring-slate-200/70', className)}>
      <div className="flex items-center gap-3">
        <div className="relative grid h-14 w-14 shrink-0 place-items-center">
          <StarIcon size={56} className="absolute inset-0 fill-amber-300 text-amber-400" />
          <span className="relative mt-1 font-display text-lg font-extrabold text-white drop-shadow-[0_1px_0_rgb(180_83_9/0.6)]">{stats.level}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="font-display text-lg font-bold text-slate-800">Cấp {stats.level}</p>
            <p className="tabular text-xs font-bold text-slate-400">
              {stats.xp - stats.levelFloorXp}/{span} XP
            </p>
          </div>
          <div className="mt-1.5 h-3 overflow-hidden rounded-full bg-slate-100 ring-1 ring-slate-200/60">
            <div
              className="h-full rounded-full bg-gradient-to-r from-amber-300 via-orange-400 to-coral-400 transition-[width] duration-700"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="mt-1 text-[11px] font-semibold text-slate-400">Thắng +30 XP · Hòa +15 · Thua +10 · Bot tính một nửa</p>
        </div>
      </div>
    </div>
  );
}

export function StatTiles({ s }: { s: ModeStats }) {
  return (
    <div className="grid gap-3 sm:grid-cols-[1.1fr_2fr]">
      <WinRateCard s={s} />
      <div className="grid grid-cols-2 gap-3">
        <Tile label="Số trận" value={s.games} tone="from-brand-50 to-white text-brand-600" />
        <Tile label="Thắng" value={s.wins} tone="from-emerald-50 to-white text-emerald-600" />
        <Tile label="Thua" value={s.losses} tone="from-coral-50 to-white text-coral-600" />
        <Tile label="Hòa" value={s.draws} tone="from-violet-50 to-white text-violet-600" />
      </div>
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className={cx('rounded-2xl bg-gradient-to-br p-4 shadow-soft ring-1 ring-slate-200/70', tone)}>
      <div className="tabular font-display text-3xl leading-none font-bold">{value}</div>
      <div className="mt-1.5 text-xs font-bold tracking-wide text-slate-500 uppercase">{label}</div>
    </div>
  );
}

function WinRateCard({ s }: { s: ModeStats }) {
  const r = 42;
  const c = 2 * Math.PI * r;
  const part = (n: number) => (s.games ? (n / s.games) * c : 0);
  const segments = [
    { len: part(s.wins), color: 'stroke-emerald-400' },
    { len: part(s.draws), color: 'stroke-violet-400' },
    { len: part(s.losses), color: 'stroke-coral-400' },
  ];
  let offset = 0;
  return (
    <div className="flex items-center gap-4 rounded-2xl bg-white/90 p-4 shadow-soft ring-1 ring-slate-200/70 sm:flex-col sm:justify-center sm:text-center">
      <div className="relative h-28 w-28 shrink-0">
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" aria-hidden="true">
          <circle cx="50" cy="50" r={r} fill="none" strokeWidth="11" className="stroke-slate-100" />
          {segments.map((seg, i) => {
            const el = (
              <circle
                key={i}
                cx="50"
                cy="50"
                r={r}
                fill="none"
                strokeWidth="11"
                strokeDasharray={`${seg.len} ${c - seg.len}`}
                strokeDashoffset={-offset}
                className={cx(seg.color, 'transition-all duration-700')}
              />
            );
            offset += seg.len;
            return seg.len > 0 ? el : null;
          })}
        </svg>
        <div className="absolute inset-0 grid place-items-center">
          <div>
            <div className="tabular font-display text-2xl leading-none font-bold text-slate-800">{s.winRate}%</div>
            <div className="mt-0.5 text-[10px] font-bold tracking-wide text-slate-400 uppercase">Tỉ lệ thắng</div>
          </div>
        </div>
      </div>
      <ul className="space-y-1 text-xs font-bold text-slate-500">
        {(['win', 'draw', 'loss'] as const).map((k) => (
          <li key={k} className="flex items-center gap-1.5 sm:justify-center">
            <span className={cx('h-2.5 w-2.5 rounded-full', RESULT_STYLE[k].dot)} />
            {RESULT_STYLE[k].label}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Highlights({ stats }: { stats: PlayerStats }) {
  const streak = stats.currentStreak;
  const streakText =
    streak.count === 0 ? '—' : `${streak.count} ${streak.result === 'win' ? 'thắng' : streak.result === 'loss' ? 'thua' : 'hòa'}`;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
      <Highlight icon={<FireIcon size={18} />} tone="bg-orange-50 text-orange-500" label="Chuỗi hiện tại" value={streakText} />
      <Highlight icon={<ZapIcon size={18} />} tone="bg-emerald-50 text-emerald-500" label="Chuỗi thắng dài nhất" value={stats.bestWinStreak ? `${stats.bestWinStreak} ván` : '—'} />
      <Highlight icon={<Trophy className="h-5 w-5" />} tone="bg-amber-50" label="Cúp vô địch giải" value={String(stats.tournamentTitles)} />
      <Highlight icon={<StarIcon size={18} />} tone="bg-brand-50 text-brand-500" label="Thắng nhanh nhất" value={stats.fastestWinMoves ? `${stats.fastestWinMoves} nước` : '—'} />
      <Highlight icon={<ClockIcon size={18} />} tone="bg-violet-50 text-violet-500" label="Thời gian chơi" value={formatPlayTime(stats.totalPlayMs)} />
      <Highlight
        icon={<GridIcon size={18} />}
        tone="bg-sky-50 text-sky-500"
        label="Bàn cờ yêu thích"
        value={stats.favoriteBoardSize ? `${stats.favoriteBoardSize}×${stats.favoriteBoardSize}` : '—'}
      />
    </div>
  );
}

function Highlight({ icon, tone, label, value }: { icon: ReactNode; tone: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-white/90 p-3 shadow-soft ring-1 ring-slate-200/70">
      <span className={cx('grid h-10 w-10 shrink-0 place-items-center rounded-xl', tone)}>{icon}</span>
      <div className="min-w-0">
        <div className="truncate font-display text-lg leading-tight font-bold text-slate-800">{value}</div>
        <div className="truncate text-[11px] font-bold tracking-wide text-slate-400 uppercase">{label}</div>
      </div>
    </div>
  );
}

const BOTS: BotDifficulty[] = ['easy', 'medium', 'hard'];
/** Thắng / Hòa / Bại: "Thắng" and "Thua" share a first letter. */
const FORM_LETTER = { win: 'T', draw: 'H', loss: 'B' } as const;

export function BotWins({ wins }: { wins: PlayerStats['botWins'] }) {
  return (
    <div className="rounded-2xl bg-white/90 p-4 shadow-soft ring-1 ring-slate-200/70">
      <p className="text-xs font-bold tracking-wide text-slate-400 uppercase">Đã hạ Bot</p>
      <div className="mt-2.5 grid grid-cols-3 gap-2">
        {BOTS.map((d) => (
          <div key={d} className={cx('flex flex-col items-center gap-1 rounded-xl p-2 ring-1', wins[d] ? 'bg-slate-50 ring-slate-200' : 'ring-slate-100 opacity-60')}>
            <AvatarImage avatar={`preset:bot-${d}`} seed={d} name={BOT_LEVEL[d]} className="h-10 w-10 rounded-xl bg-white" />
            <span className="text-[11px] font-bold text-slate-500">{BOT_LEVEL[d]}</span>
            <span className="tabular font-display text-lg leading-none font-bold text-slate-800">×{wins[d]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function RecentForm({ form }: { form: PlayerStats['recentForm'] }) {
  return (
    <div className="rounded-2xl bg-white/90 p-4 shadow-soft ring-1 ring-slate-200/70">
      <p className="text-xs font-bold tracking-wide text-slate-400 uppercase">Phong độ 10 ván gần nhất</p>
      {form.length ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {form.map((r, i) => (
            <span
              key={i}
              title={RESULT_STYLE[r].label}
              className={cx('grid h-8 w-8 place-items-center rounded-lg font-display text-sm font-bold text-white', RESULT_STYLE[r].dot, i === 0 && 'ring-2 ring-offset-2 ring-slate-300')}
            >
              {FORM_LETTER[r]}
            </span>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-sm text-slate-400">Chưa có ván nào.</p>
      )}
    </div>
  );
}
