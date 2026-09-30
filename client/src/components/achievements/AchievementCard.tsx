import { rewardCoins, type AchievementReward, type AchievementView } from '../../lib/achievements';
import { Link } from 'react-router';
import { cx } from '../../lib/cx';
import { CheckIcon, CoinIcon, LockIcon } from '../icons';
import { PlayerName } from '../PlayerName';
import { EquipTitleButton } from '../titles/EquipTitleButton';
import { TitleBadge, TitleRarityChip, type TitleMotion } from '../titles/TitleBadge';
import { AchievementIcon } from './AchievementIcon';
import { formatCoins, RARITY_STYLE } from './rarity';

const dateFmt = new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });

export function RarityChip({ rarity, className }: { rarity: AchievementView['rarity']; className?: string }) {
  const style = RARITY_STYLE[rarity];
  return (
    <span className={cx('inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[10px] font-extrabold tracking-wide uppercase ring-1', style.chip, className)}>
      {style.label}
    </span>
  );
}

export function CoinPill({ amount }: { amount: number }) {
  return (
    <span className="inline-flex h-6 items-center gap-1 rounded-full bg-amber-50 px-2 text-xs font-extrabold text-amber-700 ring-1 ring-amber-200">
      <CoinIcon size={14} /> +{formatCoins(amount)}
    </span>
  );
}

/**
 * An achievement's rewards: coins, titles and name styles (secret ones read
 * "Danh hiệu bí mật" / "Hiệu ứng tên bí mật"). `received`: the player has them; owned titles then get their
 * equip button. `motion`: how the title badges animate (see TitleBadge).
 */
export function RewardList({
  rewards,
  received,
  motion = 'hover',
  className,
}: {
  rewards: readonly AchievementReward[];
  received: boolean;
  motion?: TitleMotion;
  className?: string;
}) {
  if (!rewards.length) return null;
  const coins = rewardCoins(rewards);
  const titles = rewards.filter((r) => r.type === 'title');
  const nameStyles = rewards.filter((r) => r.type === 'nameStyle');
  return (
    <div className={cx('rounded-xl bg-slate-50/80 px-2.5 py-2 ring-1 ring-slate-100', className)}>
      <p className="text-[11px] font-extrabold tracking-wide text-slate-400 uppercase">
        <span aria-hidden>🎁</span> {received ? 'Đã nhận' : 'Phần thưởng'}
      </p>
      <div className="mt-1.5 flex flex-col gap-1.5">
        {coins > 0 && (
          <div>
            <CoinPill amount={coins} />
          </div>
        )}
        {titles.map((r, i) =>
          r.title ? (
            <div key={r.title.id} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <TitleBadge title={r.title} size="md" motion={motion} locked={!received} />
              <TitleRarityChip rarity={r.title.rarity} suffix="danh hiệu" />
              {received && <EquipTitleButton titleId={r.title.id} titleName={r.title.name} allowUnequip={false} className="ml-auto" />}
            </div>
          ) : (
            <div key={`secret-${i}`} className="flex min-w-0 items-center gap-2">
              <TitleBadge title={null} size="md" />
              <span className="text-xs font-bold text-slate-400">Danh hiệu bí mật</span>
            </div>
          ),
        )}
        {nameStyles.map((r, i) =>
          r.nameStyle ? (
            <div key={r.nameStyle.id} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <span className="inline-flex h-7 max-w-full items-center rounded-lg bg-white px-2 ring-1 ring-slate-200">
                <PlayerName name={r.nameStyle.name} nameStyle={r.nameStyle.id} className="truncate font-display text-sm font-bold text-slate-700" />
              </span>
              <TitleRarityChip rarity={r.nameStyle.rarity} suffix="hiệu ứng tên" />
              {received && (
                <Link to="/me/name-styles" className="ml-auto text-xs font-bold text-brand-600 hover:underline">
                  Trang bị →
                </Link>
              )}
            </div>
          ) : (
            <div key={`secret-style-${i}`} className="flex min-w-0 items-center gap-2">
              <span className="inline-flex h-7 items-center gap-1 rounded-lg bg-slate-900 px-2 font-display text-sm font-bold text-fuchsia-200">
                <LockIcon size={13} /> ???
              </span>
              <span className="text-xs font-bold text-slate-400">Hiệu ứng tên bí mật</span>
            </div>
          ),
        )}
      </div>
    </div>
  );
}

function ProgressLine({ a }: { a: AchievementView }) {
  const style = RARITY_STYLE[a.rarity];
  // Lower-is-better goals (fastest win): show the best so far against the target.
  const label =
    a.comparison === 'lte'
      ? a.current
        ? `Tốt nhất ${a.current} · cần ≤ ${a.target}`
        : `Chưa có · cần ≤ ${a.target}`
      : `${(a.current ?? 0).toLocaleString('vi-VN')} / ${(a.target ?? 0).toLocaleString('vi-VN')}`;
  return (
    <div className="mt-3">
      <div className="flex items-baseline justify-between gap-2 text-xs font-bold">
        <span className="tabular text-slate-500">{label}</span>
        <span className="tabular text-slate-400">{a.percentage}%</span>
      </div>
      <div
        className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100 ring-1 ring-slate-200/60"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={a.percentage}
        aria-label={`Tiến độ ${a.name}`}
      >
        <div className={cx('h-full rounded-full transition-[width] duration-700', style.bar)} style={{ width: `${a.percentage}%` }} />
      </div>
    </div>
  );
}

export function AchievementCard({ a }: { a: AchievementView }) {
  const style = RARITY_STYLE[a.rarity];
  const state = a.unlocked ? 'unlocked' : a.secret ? 'secret' : 'locked';
  return (
    <article
      className={cx(
        'tb-hover-host relative flex flex-col rounded-2xl p-4 shadow-soft ring-1 transition-transform',
        a.unlocked ? cx(style.card, 'ring-2 hover:-translate-y-0.5') : 'bg-white/75 ring-slate-200/70',
      )}
      aria-label={`${a.name}${a.unlocked ? ', đã mở khóa' : ''}`}
    >
      {a.unlocked && (
        <span className="absolute -top-2 -right-2 grid h-7 w-7 place-items-center rounded-full bg-emerald-500 text-white shadow-soft ring-2 ring-white" title="Đã mở khóa">
          <CheckIcon size={15} strokeWidth={3} />
        </span>
      )}
      <div className="flex items-start gap-3">
        <AchievementIcon icon={a.icon} rarity={a.rarity} state={state} className="h-14 w-14" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className={cx('font-display text-[17px] leading-tight font-bold', a.unlocked ? 'text-slate-800' : 'text-slate-600')}>{a.name}</h3>
            <RarityChip rarity={a.rarity} className={cx('mt-0.5', !a.unlocked && 'opacity-70')} />
          </div>
          <p className={cx('mt-0.5 text-sm', a.unlocked ? 'text-slate-500' : 'text-slate-400')}>{a.description}</p>
        </div>
      </div>

      <div className="mt-auto">
        <RewardList rewards={a.rewards} received={a.unlocked} className="mt-3" />
        {a.unlocked ? (
          <p className="mt-3 flex items-center gap-1.5 text-xs font-bold text-emerald-600">
            <CheckIcon size={14} strokeWidth={3} /> Đã mở khóa{a.unlockedAt ? ` · ${dateFmt.format(a.unlockedAt)}` : ''}
          </p>
        ) : a.secret ? (
          <p className="mt-3 flex items-center gap-1.5 text-xs font-bold text-slate-400">
            <LockIcon size={14} /> Tiếp tục chơi để khám phá
          </p>
        ) : (
          <ProgressLine a={a} />
        )}
      </div>
    </article>
  );
}
