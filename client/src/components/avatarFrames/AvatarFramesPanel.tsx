import { useEffect, useMemo, useRef, useState } from 'react';
import { buyAvatarFrame, equipAvatarFrame, fetchAvatarFrames, useAuth } from '../../lib/account';
import { useAchievementsVersion } from '../../lib/achievements';
import { useMyAvatar } from '../../lib/avatar';
import { avatarFrameVisual, DEFAULT_AVATAR_FRAME, type AvatarFrameOverview, type AvatarFrameView } from '../../lib/avatarFrames';
import { cx } from '../../lib/cx';
import { RARITIES, type Rarity } from '../../lib/rarity';
import { RarityChip } from '../achievements/AchievementCard';
import { formatCoins, RARITY_STYLE } from '../achievements/rarity';
import { AvatarImage } from '../Avatar';
import { AvatarFrameLayer, AvatarWithFrame } from '../AvatarWithFrame';
import { CheckIcon, CoinIcon, EyeIcon, FrameIcon, LockIcon, TrophyIcon } from '../icons';
import { Modal } from '../Modal';
import { PlayerName } from '../PlayerName';
import { useToast } from '../Toasts';
import { Button, Card, Spinner } from '../ui';

/**
 * Profile → Khung Avatar: the avatar frame collection. Clicking a card previews
 * the frame on the player's own avatar (client-side only); nothing changes for
 * anyone else until "Trang bị". Prices, ownership and unlock rules all come
 * from the server, which re-checks every purchase and equip.
 */
export function AvatarFramesPanel() {
  const { user } = useAuth();
  const avatar = useMyAvatar();
  const toast = useToast();
  const [data, setData] = useState<AvatarFrameOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [filter, setFilter] = useState<Rarity | null>(null);
  /** Frame being tried on; null = the equipped one. */
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /** Synchronous guard: a second click before React re-renders must not send a second request. */
  const inFlight = useRef(false);
  const [buying, setBuying] = useState<AvatarFrameView | null>(null);
  // An achievement can grant a frame: refetch whenever something unlocks.
  const version = useAchievementsVersion();

  useEffect(() => {
    let live = true;
    void fetchAvatarFrames().then((res) => {
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
    for (const f of data?.frames ?? []) {
      for (const key of [null, f.rarity] as const) {
        const c = by.get(key) ?? { owned: 0, total: 0 };
        c.total++;
        if (f.owned) c.owned++;
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

  const selected = data.frames.find((f) => f.id === (previewId ?? data.equippedAvatarFrame)) ?? data.frames[0];
  const list = filter ? data.frames.filter((f) => f.rarity === filter) : data.frames;
  const face = avatar || user.avatar;

  /** One request at a time, whatever the clicking. */
  const run = async (id: string, fn: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(id);
    try {
      await fn();
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  };

  const equip = (f: AvatarFrameView) =>
    run(f.id, async () => {
      const res = await equipAvatarFrame(f.id);
      if (!res.ok) {
        toast(res.message, 'error');
        setRetry((n) => n + 1);
        return;
      }
      setData((d) => d && { ...d, ...stateOf(res), frames: d.frames.map((x) => ({ ...x, equipped: x.id === res.equippedAvatarFrame })) });
      setPreviewId(null);
      toast(f.id === DEFAULT_AVATAR_FRAME ? 'Đã về avatar mặc định.' : 'Đã trang bị khung avatar.', 'success');
    });

  const buy = (f: AvatarFrameView) =>
    run(f.id, async () => {
      const res = await buyAvatarFrame(f.id);
      setBuying(null);
      if (!res.ok) {
        toast(res.message, res.error === 'ALREADY_OWNED' ? 'info' : 'error');
        // Out of date (bought in another tab, balance changed): show the server's view.
        setRetry((n) => n + 1);
        return;
      }
      setData((d) => d && { ...d, ...stateOf(res), frames: d.frames.map((x) => (x.id === f.id ? res.frame : x)) });
      setPreviewId(f.id);
      toast('Mua khung avatar thành công. Bấm Trang bị để dùng ngay!', 'success');
    });

  return (
    <section aria-labelledby="avatar-frames-title" className="space-y-4">
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-5 p-5 sm:p-6 md:flex-row md:items-center">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-sky-400 to-brand-600 text-white shadow-[0_8px_20px_-8px_rgb(37_99_235/0.7)]">
                <FrameIcon size={24} />
              </span>
              <div>
                <h2 id="avatar-frames-title" className="font-display text-2xl leading-none font-extrabold tracking-wide text-slate-800 uppercase">
                  Khung Avatar
                </h2>
                <p className="mt-1 text-sm font-semibold text-slate-500">
                  <span className="tabular text-slate-700">{counts.get(null)?.owned ?? 0}</span> / <span className="tabular">{counts.get(null)?.total ?? 0}</span> đã sở hữu · đối
                  thủ cũng nhìn thấy khung của bạn
                </p>
              </div>
            </div>

            <FramePreview frame={selected} avatar={face} seed={user.id} name={user.nickname} nameStyle={user.nameStyle} equipped={selected.id === data.equippedAvatarFrame} />
          </div>

          <div className="flex flex-col gap-2.5 md:w-64">
            <div className="flex items-center gap-2 self-start rounded-2xl bg-amber-50 px-3.5 py-2.5 ring-1 ring-amber-200">
              <CoinIcon size={26} />
              <div>
                <div className="tabular font-display text-xl leading-none font-bold text-amber-700">{formatCoins(data.coins)}</div>
                <div className="text-[10px] font-bold tracking-wide text-amber-600/80 uppercase">Coin</div>
              </div>
            </div>
            <FrameAction frame={selected} coins={data.coins} busy={busy === selected.id} locked={!!busy} onEquip={() => void equip(selected)} onBuy={() => setBuying(selected)} size="lg" />
            {previewId && previewId !== data.equippedAvatarFrame && (
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
        {list.map((f) => (
          <FrameCard
            key={f.id}
            f={f}
            avatar={face}
            seed={user.id}
            name={user.nickname}
            coins={data.coins}
            previewing={f.id === selected.id}
            busy={busy === f.id}
            locked={!!busy}
            onPreview={() => setPreviewId(f.id)}
            onEquip={() => void equip(f)}
            onBuy={() => setBuying(f)}
          />
        ))}
      </div>

      <BuyDialog
        frame={buying}
        avatar={face}
        seed={user.id}
        name={user.nickname}
        coins={data.coins}
        busy={!!buying && busy === buying.id}
        onCancel={() => setBuying(null)}
        onConfirm={(f) => void buy(f)}
      />
    </section>
  );
}

const stateOf = (s: { ownedAvatarFrames: string[]; equippedAvatarFrame: string; coins: number }) => ({
  ownedAvatarFrames: s.ownedAvatarFrames,
  equippedAvatarFrame: s.equippedAvatarFrame,
  coins: s.coins,
});

/** The player's real avatar wearing `frame`; a locked secret frame shows only a question mark. */
function FramedFace({ frame, avatar, seed, name, className, animated = true }: { frame: AvatarFrameView; avatar: string | null; seed: string; name: string; className: string; animated?: boolean }) {
  if (frame.secret) {
    return (
      <AvatarImage avatar={avatar} seed={seed} name={name} className={cx(className, 'grayscale-[0.7] opacity-80')}>
        <AvatarFrameLayer visual="mystery" />
      </AvatarImage>
    );
  }
  return <AvatarWithFrame avatar={avatar} frameId={frame.id} seed={seed} name={name} className={className} animated={animated} />;
}

function FramePreview({
  frame,
  avatar,
  seed,
  name,
  nameStyle,
  equipped,
}: {
  frame: AvatarFrameView;
  avatar: string | null;
  seed: string;
  name: string;
  nameStyle?: string;
  equipped: boolean;
}) {
  return (
    <div className="mt-4 rounded-2xl bg-gradient-to-br from-slate-50 to-white p-5 ring-1 ring-slate-200/70">
      <div className="flex items-center justify-between gap-2 text-[11px] font-extrabold tracking-wide text-slate-400 uppercase">
        <span className="inline-flex items-center gap-1">
          <EyeIcon size={13} /> {equipped ? 'Đang dùng' : 'Xem thử'}
        </span>
        <RarityChip rarity={frame.rarity} />
      </div>
      <div className="mt-4 flex flex-col items-center gap-5 text-center sm:flex-row sm:text-left">
        <div className="grid h-32 w-32 shrink-0 place-items-center">
          <FramedFace frame={frame} avatar={avatar} seed={seed} name={name} className="h-24 w-24 rounded-[28px] bg-white text-3xl shadow-lift" />
        </div>
        <div className="min-w-0">
          <p className={cx('font-display text-2xl font-bold', frame.secret ? 'text-slate-300' : 'text-slate-800')}>{frame.name}</p>
          <p className="mt-1 text-sm text-slate-500">{frame.description}</p>
          <div className="mt-3 flex items-center justify-center gap-4 sm:justify-start" aria-hidden="true">
            {/* The same frame at the sizes other screens use: it scales with the avatar. */}
            {(['h-12 w-12 rounded-2xl', 'h-8 w-8 rounded-[10px] text-xs'] as const).map((size) => (
              <FramedFace key={size} frame={frame} avatar={avatar} seed={seed} name={name} className={cx(size, 'bg-white')} />
            ))}
            {!frame.secret && <PlayerName name={name} nameStyle={nameStyle} className="truncate font-display text-sm font-bold text-slate-700" />}
          </div>
        </div>
      </div>
    </div>
  );
}

function FrameCard({
  f,
  avatar,
  seed,
  name,
  coins,
  previewing,
  busy,
  locked,
  onPreview,
  onEquip,
  onBuy,
}: {
  f: AvatarFrameView;
  avatar: string | null;
  seed: string;
  name: string;
  coins: number;
  previewing: boolean;
  busy: boolean;
  locked: boolean;
  onPreview: () => void;
  onEquip: () => void;
  onBuy: () => void;
}) {
  const style = RARITY_STYLE[f.rarity];
  const status = f.equipped ? 'Đang dùng' : f.owned ? 'Đã sở hữu' : f.secret ? 'Bí mật' : f.price !== null ? 'Có thể mua' : 'Đã khóa';
  return (
    <article
      className={cx(
        'relative flex flex-col rounded-2xl p-4 shadow-soft transition-transform',
        f.owned ? cx(style.card, 'ring-1') : 'bg-white/80 ring-1 ring-slate-200/70',
        previewing && 'ring-2 ring-brand-400',
      )}
      aria-label={`${f.name}, ${status}`}
    >
      {f.equipped && (
        <span className="absolute -top-2 -right-2 z-10 grid h-7 w-7 place-items-center rounded-full bg-emerald-500 text-white shadow-soft ring-2 ring-white" title="Đang dùng">
          <CheckIcon size={15} strokeWidth={3} />
        </span>
      )}
      <button
        type="button"
        onClick={onPreview}
        aria-label={f.secret ? 'Xem khung bí mật' : `Xem thử ${f.name}`}
        aria-pressed={previewing}
        className="grid h-28 place-items-center rounded-xl bg-white ring-1 ring-slate-200/70 transition-colors hover:ring-brand-200 focus-visible:ring-4 focus-visible:ring-brand-200 focus-visible:outline-none"
      >
        {/* Cards stay still; the preview above animates. Keeps a full grid cheap to draw. */}
        <FramedFace frame={f} avatar={avatar} seed={seed} name={name} className="h-16 w-16 rounded-2xl bg-slate-50 text-xl" animated={false} />
      </button>
      <div className="mt-3 flex items-start justify-between gap-2">
        <h3 className={cx('font-display text-[17px] leading-tight font-bold', f.secret ? 'text-slate-400' : 'text-slate-800')}>{f.name}</h3>
        <RarityChip rarity={f.rarity} className="mt-0.5" />
      </div>
      <p className="mt-0.5 text-sm text-slate-500">{f.description}</p>
      <div className="mt-auto pt-3">
        <FrameAction frame={f} coins={coins} busy={busy} locked={locked} onEquip={onEquip} onBuy={onBuy} />
      </div>
    </article>
  );
}

/** Equipped → Đang dùng / Owned → Trang bị / Sold → Mua / Locked → how to unlock it (never for a secret). */
function FrameAction({
  frame: f,
  coins,
  busy,
  locked,
  onEquip,
  onBuy,
  size = 'sm',
}: {
  frame: AvatarFrameView;
  coins: number;
  busy: boolean;
  /** Another request is running. */
  locked: boolean;
  onEquip: () => void;
  onBuy: () => void;
  size?: 'sm' | 'lg';
}) {
  const buttonSize = size === 'lg' ? 'md' : 'sm';
  if (f.equipped) {
    return (
      <p className="flex h-9 items-center gap-1.5 text-sm font-bold text-emerald-600">
        <CheckIcon size={16} strokeWidth={3} /> Đang dùng
      </p>
    );
  }
  if (f.owned) {
    return (
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-slate-400">Đã sở hữu</span>
        <Button variant="primary" size={buttonSize} loading={busy} disabled={locked && !busy} onClick={onEquip}>
          Trang bị
        </Button>
      </div>
    );
  }
  if (f.price !== null) {
    const short = coins < f.price;
    return (
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-slate-400">Có thể mua</span>
        <Button
          variant={short ? 'secondary' : 'success'}
          size={buttonSize}
          loading={busy}
          disabled={short || (locked && !busy)}
          onClick={onBuy}
          icon={!busy && <CoinIcon size={16} />}
          title={short ? `Còn thiếu ${formatCoins(f.price - coins)} Coin` : undefined}
        >
          {short ? `${formatCoins(f.price)} · Chưa đủ Coin` : `Mua — ${formatCoins(f.price)} Coin`}
        </Button>
      </div>
    );
  }
  if (f.achievement) {
    return (
      <p className="flex items-start gap-1.5 text-xs font-bold text-slate-500">
        <LockIcon size={14} className="mt-px shrink-0 text-slate-400" />
        <span>
          Mở khóa bằng thành tích: <span className="inline-flex items-center gap-1 text-slate-700"><TrophyIcon size={13} className="text-amber-500" />“{f.achievement.name}”</span>
        </span>
      </p>
    );
  }
  return (
    <p className="flex items-center gap-1.5 text-xs font-bold text-slate-400">
      <LockIcon size={14} /> {f.secret ? 'Điều kiện: ???' : f.unlock === 'event' ? 'Phần thưởng sự kiện' : 'Đã khóa'}
    </p>
  );
}

function BuyDialog({
  frame: f,
  avatar,
  seed,
  name,
  coins,
  busy,
  onCancel,
  onConfirm,
}: {
  frame: AvatarFrameView | null;
  avatar: string | null;
  seed: string;
  name: string;
  coins: number;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (f: AvatarFrameView) => void;
}) {
  const visual = f && avatarFrameVisual(f.id);
  return (
    <Modal open={!!f} onClose={busy ? undefined : onCancel} labelledBy="buy-frame-title" className="text-center">
      {f && f.price !== null && (
        <>
          <h2 id="buy-frame-title" className="font-display text-xl font-bold text-slate-800">
            Mua khung “{f.name}”?
          </h2>
          <div className="mt-4 grid place-items-center rounded-2xl bg-slate-50 py-6 ring-1 ring-slate-100">
            <AvatarWithFrame avatar={avatar} frameId={visual ? f.id : null} seed={seed} name={name} className="h-20 w-20 rounded-3xl bg-white text-2xl" />
            <RarityChip rarity={f.rarity} className="mt-4" />
          </div>
          <p className="mt-4 text-sm font-semibold text-slate-500">
            Giá <span className="font-extrabold text-amber-700">{formatCoins(f.price)} Coin</span> · còn lại{' '}
            <span className="tabular font-bold text-slate-700">{formatCoins(Math.max(0, coins - f.price))}</span>
          </p>
          <div className="mt-5 grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={onCancel} disabled={busy}>
              Hủy
            </Button>
            <Button variant="success" loading={busy} onClick={() => onConfirm(f)} icon={!busy && <CoinIcon size={18} />} data-autofocus>
              Mua
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
