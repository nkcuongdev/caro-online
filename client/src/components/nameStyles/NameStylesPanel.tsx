import { useEffect, useMemo, useState } from 'react';
import { buyNameStyle, equipNameStyle, fetchNameStyles, useAuth } from '../../lib/account';
import { useAchievementsVersion } from '../../lib/achievements';
import { useMyAvatar } from '../../lib/avatar';
import { cx } from '../../lib/cx';
import type { NameStyleOverview, NameStyleView } from '../../lib/nameStyles';
import { RARITIES, type Rarity } from '../../lib/rarity';
import { RarityChip } from '../achievements/AchievementCard';
import { formatCoins, RARITY_STYLE } from '../achievements/rarity';
import { AvatarWithFrame } from '../AvatarWithFrame';
import { CheckIcon, CoinIcon, EyeIcon, LockIcon, NameStyleIcon, TrophyIcon } from '../icons';
import { Modal } from '../Modal';
import { PlayerName } from '../PlayerName';
import { useToast } from '../Toasts';
import { Button, Card, Spinner } from '../ui';

/**
 * Profile → Hiệu ứng tên: the name style collection. Clicking a card previews the
 * style on the player's own name (client-side only); nothing changes for
 * anyone else until "Trang bị". Prices, ownership and unlock rules all come
 * from the server, which re-checks every purchase and equip.
 */
export function NameStylesPanel() {
  const { user } = useAuth();
  const avatar = useMyAvatar();
  const toast = useToast();
  const [data, setData] = useState<NameStyleOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [filter, setFilter] = useState<Rarity | null>(null);
  /** Style being tried on; null = the equipped one. */
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [buying, setBuying] = useState<NameStyleView | null>(null);
  // An achievement can grant a style: refetch whenever something unlocks.
  const version = useAchievementsVersion();

  useEffect(() => {
    let live = true;
    void fetchNameStyles().then((res) => {
      if (!live) return;
      if (res.ok) {
        setData(res);
        setError(null);
      } else setError(res.message);
    });
    return () => {
      live = false;
    };
  }, [version, retry, user?.id]);

  const counts = useMemo(() => {
    const by = new Map<Rarity | null, { owned: number; total: number }>();
    for (const s of data?.styles ?? []) {
      for (const key of [null, s.rarity] as const) {
        const c = by.get(key) ?? { owned: 0, total: 0 };
        c.total++;
        if (s.owned) c.owned++;
        by.set(key, c);
      }
    }
    return by;
  }, [data]);

  if (!user) return null;
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

  const selected = data.styles.find((s) => s.id === (previewId ?? data.equipped)) ?? data.styles[0];
  const list = filter ? data.styles.filter((s) => s.rarity === filter) : data.styles;

  const equip = async (s: NameStyleView) => {
    setBusy(s.id);
    const res = await equipNameStyle(s.id);
    setBusy(null);
    if (!res.ok) return toast(res.message, 'error');
    setData((d) => d && { ...d, equipped: res.equipped, styles: d.styles.map((x) => ({ ...x, equipped: x.id === res.equipped })) });
    setPreviewId(null);
    toast(s.id === 'default' ? 'Đã tắt hiệu ứng tên.' : `Đã trang bị “${s.name}”.`, 'success');
  };

  const buy = async (s: NameStyleView) => {
    setBusy(s.id);
    const res = await buyNameStyle(s.id);
    setBusy(null);
    setBuying(null);
    if (!res.ok) {
      toast(res.message, 'error');
      // Out of date (bought in another tab, balance changed): show the server's view.
      setRetry((n) => n + 1);
      return;
    }
    setData((d) => d && { ...d, coins: res.coins, styles: d.styles.map((x) => (x.id === s.id ? { ...x, owned: true } : x)) });
    setPreviewId(s.id);
    toast(`Đã mua “${s.name}”. Bấm Trang bị để dùng ngay!`, 'success');
  };

  return (
    <section aria-labelledby="name-styles-title" className="space-y-4">
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-5 p-5 sm:p-6 md:flex-row md:items-center">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-violet-400 to-fuchsia-500 text-white shadow-[0_8px_20px_-8px_rgb(168_85_247/0.7)]">
                <NameStyleIcon size={24} />
              </span>
              <div>
                <h2 id="name-styles-title" className="font-display text-2xl leading-none font-extrabold tracking-wide text-slate-800 uppercase">
                  Hiệu ứng tên
                </h2>
                <p className="mt-1 text-sm font-semibold text-slate-500">
                  <span className="tabular text-slate-700">{counts.get(null)?.owned ?? 0}</span> / <span className="tabular">{counts.get(null)?.total ?? 0}</span> đã sở hữu · chỉ là
                  trang trí, không ảnh hưởng ván đấu
                </p>
              </div>
            </div>

            <NamePreview name={user.nickname} avatar={avatar || user.avatar} avatarFrame={user.avatarFrame} seed={user.id} style={selected} equipped={selected.id === data.equipped} />
          </div>

          <div className="flex flex-col gap-2.5 md:w-64">
            <div className="flex items-center gap-2 self-start rounded-2xl bg-amber-50 px-3.5 py-2.5 ring-1 ring-amber-200">
              <CoinIcon size={26} />
              <div>
                <div className="tabular font-display text-xl leading-none font-bold text-amber-700">{formatCoins(data.coins)}</div>
                <div className="text-[10px] font-bold tracking-wide text-amber-600/80 uppercase">Coin</div>
              </div>
            </div>
            <StyleAction
              style={selected}
              coins={data.coins}
              busy={busy === selected.id}
              onEquip={() => void equip(selected)}
              onBuy={() => setBuying(selected)}
              size="lg"
            />
            {previewId && previewId !== data.equipped && (
              <button type="button" onClick={() => setPreviewId(null)} className="text-xs font-bold text-slate-400 hover:text-brand-600">
                Bỏ xem thử
              </button>
            )}
          </div>
        </div>
      </Card>

      <div role="tablist" aria-label="Lọc theo độ hiếm" className="flex max-w-full gap-1 overflow-x-auto rounded-2xl bg-white/80 p-1 shadow-soft ring-1 ring-slate-200/70 sm:inline-flex">
        {([null, ...RARITIES] as const).map((r) => {
          const n = counts.get(r);
          if (r && !n) return null;
          return (
            <button
              key={r ?? 'all'}
              type="button"
              role="tab"
              aria-selected={filter === r}
              onClick={() => setFilter(r)}
              className={cx(
                'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl px-3.5 font-display text-sm font-semibold whitespace-nowrap transition-all',
                filter === r ? 'bg-gradient-to-b from-brand-400 to-brand-600 text-white shadow-[0_6px_14px_-6px_rgb(37_99_235/0.6)]' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700',
              )}
            >
              {r ? RARITY_STYLE[r].label : 'Tất cả'}
              {n && (
                <span className={cx('tabular text-[11px] font-bold', filter === r ? 'text-white/80' : 'text-slate-400')}>
                  {n.owned}/{n.total}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((s) => (
          <StyleCard
            key={s.id}
            s={s}
            name={user.nickname}
            coins={data.coins}
            previewing={s.id === selected.id}
            busy={busy === s.id}
            onPreview={() => setPreviewId(s.id)}
            onEquip={() => void equip(s)}
            onBuy={() => setBuying(s)}
          />
        ))}
      </div>

      <BuyDialog style={buying} name={user.nickname} coins={data.coins} busy={!!buying && busy === buying.id} onCancel={() => setBuying(null)} onConfirm={(s) => void buy(s)} />
    </section>
  );
}

/** The player's own name in the style being tried on, as it shows in a room and in a list. */
function NamePreview({
  name,
  avatar,
  avatarFrame,
  seed,
  style,
  equipped,
}: {
  name: string;
  avatar: string | null;
  avatarFrame?: string;
  seed: string;
  style: NameStyleView;
  equipped: boolean;
}) {
  return (
    <div className="mt-4 rounded-2xl bg-gradient-to-br from-slate-50 to-white p-4 ring-1 ring-slate-200/70">
      <div className="flex items-center justify-between gap-2 text-[11px] font-extrabold tracking-wide text-slate-400 uppercase">
        <span className="inline-flex items-center gap-1">
          <EyeIcon size={13} /> {equipped ? 'Đang dùng' : 'Xem thử'}
        </span>
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <span className="truncate normal-case">{style.name}</span>
          <RarityChip rarity={style.rarity} />
        </span>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <AvatarWithFrame avatar={avatar} frameId={avatarFrame} seed={seed} name={name} className="h-14 w-14 shrink-0 rounded-2xl bg-white ring-2 ring-white shadow-soft" />
        <div className="min-w-0">
          {style.secret ? (
            <p className="font-display text-3xl font-bold text-slate-300">???</p>
          ) : (
            <PlayerName name={name} nameStyle={style.id} className="block truncate font-display text-3xl font-bold text-slate-800" />
          )}
          <p className="mt-0.5 truncate text-xs font-semibold text-slate-400">
            Trong phòng chờ:{' '}
            {style.secret ? '???' : <PlayerName name={name} nameStyle={style.id} className="font-display text-sm font-bold text-slate-700" />}
          </p>
        </div>
      </div>
    </div>
  );
}

function StyleCard({
  s,
  name,
  coins,
  previewing,
  busy,
  onPreview,
  onEquip,
  onBuy,
}: {
  s: NameStyleView;
  name: string;
  coins: number;
  previewing: boolean;
  busy: boolean;
  onPreview: () => void;
  onEquip: () => void;
  onBuy: () => void;
}) {
  const style = RARITY_STYLE[s.rarity];
  return (
    <article
      className={cx(
        'relative flex flex-col rounded-2xl p-4 shadow-soft transition-transform',
        s.owned ? cx(style.card, 'ring-1') : 'bg-white/80 ring-1 ring-slate-200/70',
        previewing && 'ring-2 ring-brand-400',
      )}
      aria-label={`${s.name}${s.equipped ? ', đang dùng' : s.owned ? ', đã sở hữu' : ''}`}
    >
      {s.equipped && (
        <span className="absolute -top-2 -right-2 grid h-7 w-7 place-items-center rounded-full bg-emerald-500 text-white shadow-soft ring-2 ring-white" title="Đang dùng">
          <CheckIcon size={15} strokeWidth={3} />
        </span>
      )}
      <button
        type="button"
        onClick={onPreview}
        disabled={s.secret}
        aria-label={s.secret ? 'Hiệu ứng tên bí mật' : `Xem thử ${s.name}`}
        className="grid h-16 place-items-center rounded-xl bg-white px-3 ring-1 ring-slate-200/70 transition-colors enabled:hover:ring-brand-200 disabled:cursor-default"
      >
        {s.secret ? (
          <span className="inline-flex items-center gap-1.5 font-display text-xl font-bold text-slate-300">
            <LockIcon size={16} /> ???
          </span>
        ) : (
          <PlayerName name={name} nameStyle={s.id} className="max-w-full truncate font-display text-xl font-bold text-slate-800" />
        )}
      </button>
      <div className="mt-3 flex items-start justify-between gap-2">
        <h3 className="font-display text-[17px] leading-tight font-bold text-slate-800">{s.name}</h3>
        <RarityChip rarity={s.rarity} className="mt-0.5" />
      </div>
      <p className="mt-0.5 text-sm text-slate-500">{s.description}</p>
      <div className="mt-auto pt-3">
        <StyleAction style={s} coins={coins} busy={busy} onEquip={onEquip} onBuy={onBuy} />
      </div>
    </article>
  );
}

/** Equipped / Owned → Trang bị / Buy → Mua / Locked → how to unlock it. */
function StyleAction({
  style: s,
  coins,
  busy,
  onEquip,
  onBuy,
  size = 'sm',
}: {
  style: NameStyleView;
  coins: number;
  busy: boolean;
  onEquip: () => void;
  onBuy: () => void;
  size?: 'sm' | 'lg';
}) {
  const buttonSize = size === 'lg' ? 'md' : 'sm';
  if (s.equipped) {
    return (
      <p className="flex h-9 items-center gap-1.5 text-sm font-bold text-emerald-600">
        <CheckIcon size={16} strokeWidth={3} /> Đang dùng
      </p>
    );
  }
  if (s.owned) {
    return (
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-slate-400">Đã sở hữu</span>
        <Button variant="primary" size={buttonSize} loading={busy} onClick={onEquip}>
          Trang bị
        </Button>
      </div>
    );
  }
  if (s.price !== null) {
    const short = coins < s.price;
    return (
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1 text-sm font-extrabold text-amber-700">
          <CoinIcon size={16} /> {formatCoins(s.price)}
        </span>
        <Button variant={short ? 'secondary' : 'success'} size={buttonSize} loading={busy} disabled={short} onClick={onBuy} title={short ? `Còn thiếu ${formatCoins(s.price - coins)} coin` : undefined}>
          {short ? 'Chưa đủ coin' : 'Mua'}
        </Button>
      </div>
    );
  }
  if (s.achievement) {
    return (
      <p className="flex items-start gap-1.5 text-xs font-bold text-slate-500">
        <TrophyIcon size={14} className="mt-px shrink-0 text-amber-500" />
        <span>
          Mở khóa bởi thành tích: <span className="text-slate-700">“{s.achievement.name}”</span>
        </span>
      </p>
    );
  }
  return (
    <p className="flex items-center gap-1.5 text-xs font-bold text-slate-400">
      <LockIcon size={14} /> {s.secret ? 'Điều kiện mở khóa: ???' : s.unlock === 'event' ? 'Phần thưởng sự kiện' : 'Chưa thể mở khóa'}
    </p>
  );
}

function BuyDialog({
  style: s,
  name,
  coins,
  busy,
  onCancel,
  onConfirm,
}: {
  style: NameStyleView | null;
  name: string;
  coins: number;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (s: NameStyleView) => void;
}) {
  return (
    <Modal open={!!s} onClose={busy ? undefined : onCancel} labelledBy="buy-style-title" className="text-center">
      {s && s.price !== null && (
        <>
          <h2 id="buy-style-title" className="font-display text-xl font-bold text-slate-800">
            Mua “{s.name}”?
          </h2>
          <div className="mt-4 rounded-2xl bg-slate-50 px-3 py-4 ring-1 ring-slate-100">
            <PlayerName name={name} nameStyle={s.id} className="block truncate font-display text-2xl font-bold text-slate-800" />
          </div>
          <p className="mt-4 text-sm font-semibold text-slate-500">
            Giá <span className="font-extrabold text-amber-700">{formatCoins(s.price)} coin</span> · còn lại{' '}
            <span className="tabular font-bold text-slate-700">{formatCoins(Math.max(0, coins - s.price))}</span>
          </p>
          <div className="mt-5 grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={onCancel} disabled={busy}>
              Hủy
            </Button>
            <Button variant="success" loading={busy} onClick={() => onConfirm(s)} icon={!busy && <CoinIcon size={18} />} data-autofocus>
              Mua
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
