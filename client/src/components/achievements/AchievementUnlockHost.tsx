import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation } from 'react-router';
import { dismissUnlockPopup, rewardCoins, rewardNameStyles, rewardTitles, useUnlockPopup, type UnlockPopup } from '../../lib/achievements';
import { celebrate } from '../../lib/confetti';
import { cx } from '../../lib/cx';
import { sfx } from '../../lib/sound';
import type { PublicTitle } from '../../lib/titles';
import { CloseIcon, SparkIcon, TrophyIcon } from '../icons';
import { PlayerName } from '../PlayerName';
import { EquipTitleButton } from '../titles/EquipTitleButton';
import { TitleBadge, TitleRarityChip } from '../titles/TitleBadge';
import { AchievementIcon } from './AchievementIcon';
import { CoinPill, RarityChip } from './AchievementCard';
import { RARITY_STYLE } from './rarity';

/** How long each popup stays up (paused while hovered or focused). */
const SHOW_MS = 5_000;
/** Longer when there's a title to equip. */
const SHOW_TITLE_MS = 9_000;
/** Wait before the first popup, so the game result lands first. */
const FIRST_DELAY_MS = 900;
/** Gap between two queued popups. */
const GAP_MS = 250;
const LEAVE_MS = 220;

/**
 * Shows unlocked achievements (and the titles they grant) one at a time, on
 * top of everything (the result modal included). The queue lives in
 * lib/achievements.ts; this only plays it, so popups never stack.
 */
export function AchievementUnlockHost() {
  const popup = useUnlockPopup();
  const [shown, setShown] = useState<UnlockPopup | null>(null);
  const lastEnd = useRef(0);
  // In a room, the link opens a new tab: leaving the page would leave the room (and a series).
  const inRoom = /^\/(game|t)\//.test(useLocation().pathname);

  // A new head of the queue: show it after a short beat.
  useEffect(() => {
    if (!popup) {
      setShown(null);
      return;
    }
    if (shown?.key === popup.key) return;
    const idle = Date.now() - lastEnd.current > 1_500;
    const t = window.setTimeout(() => setShown(popup), idle ? FIRST_DELAY_MS : GAP_MS);
    return () => window.clearTimeout(t);
    // `shown` is only read to skip a re-show of the same popup.
  }, [popup]);

  if (!shown) return null;
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[70] flex justify-center px-4 sm:top-5">
      <PopupCard
        key={shown.key}
        popup={shown}
        newTab={inRoom}
        onDone={() => {
          lastEnd.current = Date.now();
          dismissUnlockPopup(shown.key);
        }}
      />
    </div>,
    document.body,
  );
}

/** New titles in a popup: the first one big, with its equip button. */
function titlesOf(popup: UnlockPopup): PublicTitle[] {
  if (popup.kind === 'one') return rewardTitles(popup.achievement.rewards);
  return popup.titles;
}

function PopupCard({ popup, newTab, onDone }: { popup: UnlockPopup; newTab: boolean; onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);
  const [paused, setPaused] = useState(false);
  const titles = titlesOf(popup);
  const showMs = titles.length ? SHOW_TITLE_MS : SHOW_MS;
  const remaining = useRef(showMs);
  const startedAt = useRef(0);
  const doneRef = useRef(onDone);
  useEffect(() => {
    doneRef.current = onDone;
  });

  const rarity = popup.kind === 'one' ? popup.achievement.rarity : popup.kind === 'titles' ? 'epic' : 'rare';
  const style = RARITY_STYLE[rarity];
  const bigTitle = titles.some((t) => t.rarity === 'legendary' || t.rarity === 'secret');

  // Sound (and confetti for the rarest) once, when it appears.
  useEffect(() => {
    sfx.achievement(rarity === 'epic' || rarity === 'legendary' || bigTitle);
    if (rarity === 'legendary' || bigTitle) celebrate();
  }, [rarity, bigTitle]);

  // Auto-close, paused while the pointer or focus is on the card.
  useEffect(() => {
    if (leaving || paused) return;
    startedAt.current = Date.now();
    const t = window.setTimeout(() => setLeaving(true), remaining.current);
    return () => {
      window.clearTimeout(t);
      remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt.current));
    };
  }, [leaving, paused]);

  useEffect(() => {
    if (!leaving) return;
    const t = window.setTimeout(() => doneRef.current(), LEAVE_MS);
    return () => window.clearTimeout(t);
  }, [leaving]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setLeaving(true);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const heading = popup.kind === 'titles' ? (titles.length > 1 ? `${titles.length} danh hiệu mới` : 'Danh hiệu mới') : 'Thành tích hoàn thành';
  const name = popup.kind === 'one' ? popup.achievement.name : popup.kind === 'more' ? `Và ${popup.count} thành tích khác` : null;
  const coins = popup.kind === 'one' ? rewardCoins(popup.achievement.rewards) : popup.kind === 'more' ? popup.coins : 0;
  const nameStyles = popup.kind === 'one' ? rewardNameStyles(popup.achievement.rewards) : [];

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`${heading}${name ? `: ${name}` : ''}${titles.length ? `. Danh hiệu mới: ${titles.map((t) => t.name).join(', ')}` : ''}`}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className={cx(
        'ach-shine pointer-events-auto relative w-full max-w-[400px] overflow-hidden rounded-3xl bg-white shadow-lift ring-2',
        style.ring,
        leaving ? 'ach-popup-out' : 'ach-popup-in',
        paused && 'ach-paused',
      )}
      style={{ '--ach-duration': `${showMs}ms` } as CSSProperties}
    >
      <div className={cx('flex items-center gap-1.5 px-4 pt-3 pr-12 text-[11px] font-extrabold tracking-[0.14em] uppercase', style.text)}>
        <SparkIcon size={14} /> {heading}
        {popup.kind === 'one' && <RarityChip rarity={popup.achievement.rarity} className="ml-1" />}
      </div>
      <button
        type="button"
        onClick={() => setLeaving(true)}
        aria-label="Đóng"
        className="absolute top-2 right-2 grid h-8 w-8 place-items-center rounded-xl text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
      >
        <CloseIcon size={16} />
      </button>

      {popup.kind !== 'titles' && (
        <div className="flex items-center gap-3.5 px-4 pt-2 pb-1">
          {popup.kind === 'one' ? (
            <AchievementIcon icon={popup.achievement.icon} rarity={popup.achievement.rarity} state="unlocked" glow className="h-16 w-16" />
          ) : (
            <span className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-amber-300 to-orange-400 text-white">
              <TrophyIcon size={30} />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="font-display text-lg leading-tight font-extrabold tracking-wide text-slate-800 uppercase">{name}</p>
            <p className="mt-0.5 text-sm text-slate-500">
              {popup.kind === 'one' ? popup.achievement.description : 'Đã mở khóa cùng lúc từ lịch sử ván đấu của bạn.'}
            </p>
            {(coins > 0 || nameStyles.length > 0 || (titles.length > 0 && popup.kind === 'more')) && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-extrabold tracking-wide text-slate-400 uppercase">
                  <span aria-hidden>🎁</span> Nhận được
                </span>
                {coins > 0 && <CoinPill amount={coins} />}
                {nameStyles.map((n) => (
                  <span key={n.id} className="inline-flex h-6 max-w-full items-center gap-1 rounded-full bg-white px-2 text-xs font-bold text-slate-500 ring-1 ring-slate-200">
                    Hiệu ứng tên <PlayerName name={n.name} nameStyle={n.id} className="truncate font-display font-bold text-slate-700" />
                  </span>
                ))}
                {popup.kind === 'more' && titles.map((t) => <TitleBadge key={t.id} title={t} size="sm" motion="off" />)}
              </div>
            )}
          </div>
        </div>
      )}

      {titles.length > 0 && popup.kind !== 'more' && (
        <NewTitles
          titles={titles}
          note={popup.kind === 'titles' ? 'Phần thưởng cho thành tích bạn đã hoàn thành trước đây.' : null}
          onEquipped={() => window.setTimeout(() => setLeaving(true), 700)}
        />
      )}

      <Link
        to={titles.length ? '/me/titles' : '/me/achievements'}
        onClick={() => setLeaving(true)}
        {...(newTab ? { target: '_blank', rel: 'noopener' } : {})}
        className="mx-4 mt-1 mb-3 block text-xs font-bold text-brand-600 hover:underline"
      >
        {titles.length ? 'Xem bộ sưu tập danh hiệu →' : 'Xem tất cả thành tích →'}
      </Link>
      <div className="h-1 bg-slate-100">
        <div className={cx('ach-countdown h-full', style.bar)} />
      </div>
    </div>
  );
}

function NewTitles({ titles, note, onEquipped }: { titles: PublicTitle[]; note: string | null; onEquipped: () => void }) {
  const [first, ...rest] = titles;
  return (
    <div className="mx-4 mt-2 rounded-2xl bg-gradient-to-br from-slate-50 to-violet-50/60 p-3 ring-1 ring-violet-100">
      <p className="text-[11px] font-extrabold tracking-[0.14em] text-violet-600 uppercase">
        <span aria-hidden>🎁</span> Danh hiệu mới
      </p>
      {note && <p className="mt-0.5 text-xs text-slate-500">{note}</p>}
      <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
        <TitleBadge title={first} size="lg" motion="on" />
        <TitleRarityChip rarity={first.rarity} />
      </div>
      {rest.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {rest.map((t) => (
            <TitleBadge key={t.id} title={t} size="sm" motion="off" />
          ))}
        </div>
      )}
      <EquipTitleButton titleId={first.id} titleName={first.name} size="md" allowUnequip={false} className="mt-3 w-full" onEquipped={onEquipped} />
    </div>
  );
}
