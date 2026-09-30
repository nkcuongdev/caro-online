import { useEffect, useMemo, useState } from 'react';
import { fetchAchievements } from '../../lib/account';
import { useAchievementsVersion, type AchievementCategory, type AchievementOverview, type Rarity } from '../../lib/achievements';
import { cx } from '../../lib/cx';
import { RARITIES } from '../../lib/rarity';
import { CoinIcon, TrophyIcon } from '../icons';
import { Button, Card, Spinner } from '../ui';
import { AchievementCard } from './AchievementCard';
import { CATEGORY_FILTERS, CATEGORY_LABEL, formatCoins, RARITY_STYLE } from './rarity';

const RARITY_ORDER: readonly Rarity[] = RARITIES;

/** Profile → Thành tích: every achievement with progress, filtered by category. */
export function AchievementsPanel() {
  const [data, setData] = useState<AchievementOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<AchievementCategory | null>(null);
  // Changes whenever something unlocks (a game finished in another tab, a push, …).
  const version = useAchievementsVersion();
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let live = true;
    void fetchAchievements().then((res) => {
      if (!live) return;
      if (res.ok) {
        setData(res);
        setError(null);
      } else setError(res.message);
    });
    return () => {
      live = false;
    };
  }, [version, retry]);

  const counts = useMemo(() => {
    const by = new Map<AchievementCategory | null, { done: number; total: number }>();
    for (const a of data?.achievements ?? []) {
      for (const key of [null, a.category] as const) {
        const c = by.get(key) ?? { done: 0, total: 0 };
        c.total++;
        if (a.unlocked) c.done++;
        by.set(key, c);
      }
    }
    return by;
  }, [data]);

  if (!data) {
    return (
      <div className="grid place-items-center py-16 text-brand-500">
        {error ? (
          <Card className="max-w-sm p-6 text-center">
            <p className="font-semibold text-slate-600">{error}</p>
            <Button variant="primary" className="mt-4" onClick={() => setRetry((n) => n + 1)}>
              Thử lại
            </Button>
          </Card>
        ) : (
          <Spinner className="h-8 w-8" />
        )}
      </div>
    );
  }

  const list = filter ? data.achievements.filter((a) => a.category === filter) : data.achievements;
  const { unlocked, total, percentage } = data.summary;

  return (
    <section aria-labelledby="achievements-title" className="space-y-4">
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:gap-6 sm:p-6">
          <div className="flex items-center gap-4">
            <span className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-amber-300 to-orange-400 text-white shadow-[0_8px_20px_-8px_rgb(245_158_11/0.7)]">
              <TrophyIcon size={32} />
            </span>
            <div>
              <h2 id="achievements-title" className="font-display text-2xl leading-none font-extrabold tracking-wide text-slate-800 uppercase">
                Thành tích
              </h2>
              <p className="mt-1.5 font-display text-lg font-bold text-slate-600">
                <span className="tabular text-slate-800">{unlocked}</span> / <span className="tabular">{total}</span> đã mở khóa
              </p>
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between text-xs font-bold text-slate-400">
              <span>Tiến độ tổng</span>
              <span className="tabular">{percentage}%</span>
            </div>
            <div
              className="mt-1.5 h-3 overflow-hidden rounded-full bg-slate-100 ring-1 ring-slate-200/60"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percentage}
              aria-label="Tiến độ thành tích"
            >
              <div className="h-full rounded-full bg-gradient-to-r from-amber-300 via-orange-400 to-coral-400 transition-[width] duration-700" style={{ width: `${percentage}%` }} />
            </div>
            <ul className="mt-2.5 flex flex-wrap gap-1.5" aria-label="Theo độ hiếm">
              {RARITY_ORDER.map((r) => {
                const all = data.achievements.filter((a) => a.rarity === r);
                if (!all.length) return null;
                return (
                  <li key={r} className={cx('inline-flex h-6 items-center gap-1 rounded-full px-2 text-[11px] font-extrabold ring-1', RARITY_STYLE[r].chip)}>
                    {RARITY_STYLE[r].label}
                    <span className="tabular opacity-70">
                      {all.filter((a) => a.unlocked).length}/{all.length}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="flex items-center gap-2 self-start rounded-2xl bg-amber-50 px-3.5 py-2.5 ring-1 ring-amber-200 sm:self-center">
            <CoinIcon size={26} />
            <div>
              <div className="tabular font-display text-xl leading-none font-bold text-amber-700">{formatCoins(data.coins)}</div>
              <div className="text-[10px] font-bold tracking-wide text-amber-600/80 uppercase">Coin</div>
            </div>
          </div>
        </div>
      </Card>

      <div role="tablist" aria-label="Lọc thành tích" className="flex max-w-full gap-1 overflow-x-auto rounded-2xl bg-white/80 p-1 shadow-soft ring-1 ring-slate-200/70 sm:inline-flex">
        {CATEGORY_FILTERS.map((c) => {
          const n = counts.get(c);
          return (
            <button
              key={c ?? 'all'}
              type="button"
              role="tab"
              aria-selected={filter === c}
              onClick={() => setFilter(c)}
              className={cx(
                'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl px-3.5 font-display text-sm font-semibold whitespace-nowrap transition-all',
                filter === c ? 'bg-gradient-to-b from-brand-400 to-brand-600 text-white shadow-[0_6px_14px_-6px_rgb(37_99_235/0.6)]' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700',
              )}
            >
              {c ? CATEGORY_LABEL[c] : 'Tất cả'}
              {n && <span className={cx('tabular text-[11px] font-bold', filter === c ? 'text-white/80' : 'text-slate-400')}>{n.done}/{n.total}</span>}
            </button>
          );
        })}
      </div>

      {list.length ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((a) => (
            <AchievementCard key={a.id} a={a} />
          ))}
        </div>
      ) : (
        <Card className="p-8 text-center text-sm font-semibold text-slate-400">Chưa có thành tích nào trong mục này.</Card>
      )}
    </section>
  );
}
