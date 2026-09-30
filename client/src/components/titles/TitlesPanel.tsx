import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { fetchTitles, useEquippedTitle } from '../../lib/account';
import { useAchievementsVersion } from '../../lib/achievements';
import { cx } from '../../lib/cx';
import { TITLE_EFFECT_LABEL, TITLE_RARITY_LABEL, TITLE_RARITY_ORDER, type TitleCollection, type TitleRarity, type TitleView } from '../../lib/titles';
import { CheckIcon, LockIcon, TrophyIcon } from '../icons';
import { Button, Card, Spinner } from '../ui';
import { EquipTitleButton } from './EquipTitleButton';
import { TitleBadge, TitleRarityChip } from './TitleBadge';

type Ownership = 'all' | 'owned' | 'locked';

const OWNERSHIP_TABS: { value: Ownership; label: string }[] = [
  { value: 'all', label: 'Tất cả' },
  { value: 'owned', label: 'Đã sở hữu' },
  { value: 'locked', label: 'Chưa mở khóa' },
];

const dateFmt = new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });

/** Profile → Danh hiệu: every title, owned or not, and the one in use. */
export function TitlesPanel() {
  const [data, setData] = useState<TitleCollection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [ownership, setOwnership] = useState<Ownership>('all');
  const [rarity, setRarity] = useState<TitleRarity | null>(null);
  // Refetch when something unlocks while the page is open (a game in another tab, a push, …).
  const version = useAchievementsVersion();
  // Equipping elsewhere (popup, another tab) is reflected without a refetch.
  const equipped = useEquippedTitle();

  useEffect(() => {
    let live = true;
    void fetchTitles().then((res) => {
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

  const titles = useMemo(() => (data?.titles ?? []).map((t) => ({ ...t, equipped: t.owned && !!t.title && t.title.id === equipped?.id })), [data, equipped]);

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

  const byRarity = rarity ? titles.filter((t) => t.rarity === rarity) : titles;
  const owned = byRarity.filter((t) => t.owned);
  const locked = byRarity.filter((t) => !t.owned);
  const sections =
    ownership === 'all'
      ? [
          { key: 'owned', label: 'Đã sở hữu', items: owned },
          { key: 'locked', label: 'Chưa mở khóa', items: locked },
        ]
      : [{ key: ownership, label: null, items: ownership === 'owned' ? owned : locked }];

  return (
    <section aria-labelledby="titles-title" className="space-y-4">
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:gap-6 sm:p-6">
          <div className="flex items-center gap-4">
            <span className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-violet-400 to-fuchsia-500 text-3xl text-white shadow-[0_8px_20px_-8px_rgb(168_85_247/0.7)]" aria-hidden>
              🎖️
            </span>
            <div>
              <h2 id="titles-title" className="font-display text-2xl leading-none font-extrabold tracking-wide text-slate-800 uppercase">
                Danh hiệu
              </h2>
              <p className="mt-1.5 font-display text-lg font-bold text-slate-600">
                <span className="tabular text-slate-800">{data.summary.owned}</span> / <span className="tabular">{data.summary.total}</span> đã sở hữu
              </p>
            </div>
          </div>
          <div className="min-w-0 flex-1 rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-100">
            <p className="text-[11px] font-extrabold tracking-wide text-slate-400 uppercase">Đang sử dụng</p>
            {equipped ? (
              <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-2">
                <TitleBadge title={equipped} size="lg" />
                <EquipTitleButton titleId={equipped.id} titleName={equipped.name} className="ml-auto" />
              </div>
            ) : (
              <p className="mt-1 text-sm font-semibold text-slate-500">
                Chưa trang bị danh hiệu nào. Chọn một danh hiệu bạn đã sở hữu để hiện cạnh tên của bạn.
              </p>
            )}
          </div>
        </div>
      </Card>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div role="tablist" aria-label="Lọc theo trạng thái" className="flex max-w-full gap-1 overflow-x-auto rounded-2xl bg-white/80 p-1 shadow-soft ring-1 ring-slate-200/70 sm:inline-flex">
          {OWNERSHIP_TABS.map((tab) => (
            <FilterTab key={tab.value} active={ownership === tab.value} onClick={() => setOwnership(tab.value)}>
              {tab.label}
            </FilterTab>
          ))}
        </div>
        <div role="tablist" aria-label="Lọc theo độ hiếm" className="flex max-w-full gap-1 overflow-x-auto rounded-2xl bg-white/80 p-1 shadow-soft ring-1 ring-slate-200/70 sm:inline-flex">
          <FilterTab active={rarity === null} onClick={() => setRarity(null)}>
            Mọi độ hiếm
          </FilterTab>
          {TITLE_RARITY_ORDER.map((r) => (
            <FilterTab key={r} active={rarity === r} onClick={() => setRarity(r)}>
              {TITLE_RARITY_LABEL[r]}
            </FilterTab>
          ))}
        </div>
      </div>

      {sections.map((s) => (
        <div key={s.key}>
          {s.label && (
            <h3 className="mb-2 flex items-center gap-2 font-display text-lg font-bold text-slate-700">
              {s.key === 'owned' ? <CheckIcon size={18} className="text-emerald-500" /> : <LockIcon size={17} className="text-slate-400" />}
              {s.label}
              <span className="tabular text-sm text-slate-400">{s.items.length}</span>
            </h3>
          )}
          {s.items.length ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {s.items.map((t) => (
                <TitleCard key={t.key} t={t} />
              ))}
            </div>
          ) : (
            <Card className="p-6 text-center text-sm font-semibold text-slate-400">
              {s.key === 'owned' ? (
                <>
                  Chưa có danh hiệu nào ở đây.{' '}
                  <Link to="/me/achievements" className="text-brand-600 hover:underline">
                    Hoàn thành thành tích
                  </Link>{' '}
                  để nhận danh hiệu.
                </>
              ) : (
                'Bạn đã sở hữu tất cả danh hiệu ở mục này!'
              )}
            </Card>
          )}
        </div>
      ))}
    </section>
  );
}

function FilterTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cx(
        'inline-flex h-9 shrink-0 items-center rounded-xl px-3 font-display text-sm font-semibold whitespace-nowrap transition-all',
        active ? 'bg-gradient-to-b from-brand-400 to-brand-600 text-white shadow-[0_6px_14px_-6px_rgb(37_99_235/0.6)]' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700',
      )}
    >
      {children}
    </button>
  );
}

function TitleCard({ t }: { t: TitleView }) {
  const title = t.title;
  return (
    <article
      className={cx(
        'tb-hover-host relative flex flex-col rounded-2xl p-4 shadow-soft ring-1 transition-transform hover:-translate-y-0.5',
        t.equipped ? 'bg-gradient-to-br from-white to-emerald-50 ring-2 ring-emerald-300' : t.owned ? 'bg-white ring-slate-200/80' : 'bg-white/70 ring-slate-200/60',
      )}
      aria-label={`${title?.name ?? 'Danh hiệu bí mật'}${t.equipped ? ', đang sử dụng' : t.owned ? ', đã sở hữu' : ', chưa mở khóa'}`}
    >
      {t.equipped && (
        <span className="absolute -top-2 -right-2 grid h-7 w-7 place-items-center rounded-full bg-emerald-500 text-white shadow-soft ring-2 ring-white" title="Đang sử dụng">
          <CheckIcon size={15} strokeWidth={3} />
        </span>
      )}
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {!t.owned && (
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-400" aria-hidden>
              {title ? <LockIcon size={14} /> : '❓'}
            </span>
          )}
          {/* Only the one in use moves on its own; the others while hovered. */}
          <TitleBadge title={title} size="lg" motion={t.equipped ? 'on' : 'hover'} locked={!t.owned && !!title} />
        </div>
        <TitleRarityChip rarity={t.rarity} className="mt-1.5" />
      </div>

      <p className={cx('mt-2.5 text-sm', t.owned ? 'text-slate-600' : 'text-slate-500')}>{title ? title.description : 'Danh hiệu bí mật. Tiếp tục chơi để khám phá.'}</p>
      {title && title.effect !== 'none' && <p className="mt-1 text-xs font-semibold text-slate-400">Hiệu ứng: {TITLE_EFFECT_LABEL[title.effect]}</p>}

      <div className="mt-auto pt-3">
        {t.source && (
          <div className="rounded-xl bg-slate-50 px-2.5 py-2 text-xs ring-1 ring-slate-100">
            <p className="flex items-center gap-1 font-bold text-slate-500">
              <TrophyIcon size={13} className="shrink-0 text-amber-500" />
              <span className="truncate">Thành tích: {t.source.name}</span>
            </p>
            {!t.source.secret && <p className="mt-0.5 text-slate-500">{t.source.description}</p>}
            {!t.owned && !t.source.secret && (
              <div className="mt-1.5 flex items-center gap-2">
                <div
                  className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200/70"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={t.source.percentage}
                  aria-label={`Tiến độ ${t.source.name}`}
                >
                  <div className="h-full rounded-full bg-gradient-to-r from-brand-300 to-brand-500" style={{ width: `${t.source.percentage}%` }} />
                </div>
                <span className="tabular font-bold text-slate-400">{t.source.percentage}%</span>
              </div>
            )}
          </div>
        )}
        <div className="mt-3 flex min-h-8 items-center justify-between gap-2">
          {t.owned && title ? (
            <>
              <span className="text-xs font-bold text-emerald-600">{t.unlockedAt ? `Nhận ${dateFmt.format(t.unlockedAt)}` : 'Đã sở hữu'}</span>
              <EquipTitleButton titleId={title.id} titleName={title.name} />
            </>
          ) : (
            <span className="flex items-center gap-1.5 text-xs font-bold text-slate-400">
              <LockIcon size={13} /> Chưa mở khóa
            </span>
          )}
        </div>
      </div>
    </article>
  );
}
