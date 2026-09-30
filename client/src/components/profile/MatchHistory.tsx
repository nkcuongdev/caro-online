import { useCallback, useEffect, useState } from 'react';
import { fetchMatch, fetchMatches, type MatchDetail, type MatchSummary } from '../../lib/account';
import { cx } from '../../lib/cx';
import type { RoomMode } from '../../lib/protocol';
import { AvatarImage } from '../Avatar';
import { BotIcon, ChevronDownIcon, ClockIcon, GridIcon, HistoryIcon, TrophyIcon, UsersIcon, VerifiedIcon } from '../icons';
import { MarkBadge } from '../Pieces';
import { Button, Spinner } from '../ui';
import { formatDuration, matchContext, reasonText, relativeTime, RESULT_STYLE } from './format';
import { MatchReplay } from './MatchReplay';
import { ModeTabs } from './StatsPanels';

export function MatchHistory() {
  const [mode, setMode] = useState<RoomMode | null>(null);
  const [items, setItems] = useState<MatchSummary[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  const load = useCallback(async (filter: RoomMode | null, before: number | null) => {
    setLoading(true);
    setError(null);
    const res = await fetchMatches({ mode: filter, before });
    setLoading(false);
    if (!res.ok) return setError(res.message);
    setItems((prev) => (before ? [...prev, ...res.matches] : res.matches));
    setNext(res.nextBefore);
  }, []);

  useEffect(() => {
    setItems([]);
    setOpen(null);
    void load(mode, null);
  }, [mode, load]);

  return (
    <section id="history" className="scroll-mt-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-display text-2xl font-bold text-slate-800">
            <HistoryIcon size={22} className="text-brand-500" /> Lịch sử trận đấu
          </h2>
          <p className="text-sm text-slate-500">Mọi ván bạn chơi khi đã đăng nhập. Chạm vào một ván để xem lại từng nước.</p>
        </div>
        <ModeTabs value={mode} onChange={setMode} />
      </div>

      <div className="mt-4 space-y-2.5">
        {items.map((m) => (
          <MatchRow key={m.id} match={m} open={open === m.id} onToggle={() => setOpen((o) => (o === m.id ? null : m.id))} />
        ))}

        {loading && (
          <div className="flex justify-center py-6 text-brand-500">
            <Spinner className="h-6 w-6" />
          </div>
        )}
        {!loading && error && (
          <div className="rounded-2xl bg-red-50 p-4 text-center text-sm font-semibold text-red-600 ring-1 ring-red-100">
            {error}{' '}
            <button type="button" className="font-bold underline" onClick={() => void load(mode, null)}>
              Thử lại
            </button>
          </div>
        )}
        {!loading && !error && items.length === 0 && <EmptyHistory filtered={!!mode} />}
        {!loading && next && (
          <Button variant="secondary" className="w-full" onClick={() => void load(mode, next)}>
            Xem thêm
          </Button>
        )}
      </div>
    </section>
  );
}

function MatchRow({ match: m, open, onToggle }: { match: MatchSummary; open: boolean; onToggle: () => void }) {
  const style = RESULT_STYLE[m.result];
  const [detail, setDetail] = useState<MatchDetail | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open || detail) return;
    let live = true;
    void fetchMatch(m.id).then((res) => {
      if (!live) return;
      if (res.ok) setDetail(res.match);
      else setFailed(true);
    });
    return () => {
      live = false;
    };
  }, [open, detail, m.id]);

  const opponentName = m.opponentName ?? 'Đối thủ đã rời';
  const ModeIcon = m.mode === 'bot' ? BotIcon : m.mode === 'tournament' ? TrophyIcon : UsersIcon;

  return (
    <article className={cx('overflow-hidden rounded-2xl bg-white/90 shadow-soft ring-1 transition-shadow', open ? 'ring-brand-200' : 'ring-slate-200/70')}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-3 p-3 text-left sm:gap-4 sm:p-3.5">
        <span className={cx('h-12 w-1.5 shrink-0 rounded-full', style.bar)} aria-hidden="true" />
        <span className={cx('w-14 shrink-0 rounded-xl py-1 text-center font-display text-sm font-bold ring-1', style.chip)}>{style.label}</span>

        <span className="flex min-w-0 flex-1 items-center gap-2.5">
          <AvatarImage avatar={m.opponentAvatar} seed={`${m.roomId}:${m.opponentName}`} name={opponentName} className="h-10 w-10 rounded-xl bg-slate-50 ring-1 ring-slate-200" />
          <span className="min-w-0">
            <span className="flex items-center gap-1">
              <span className="truncate text-xs font-semibold text-slate-400">vs</span>
              <span className="truncate font-display text-[15px] font-semibold text-slate-800">{opponentName}</span>
              {m.opponentRegistered && (
                <span title="Thành viên đã đăng ký" className="shrink-0">
                  <VerifiedIcon size={14} className="text-brand-500" />
                </span>
              )}
            </span>
            <span className="flex min-w-0 items-center gap-1 text-xs font-semibold text-slate-500">
              <ModeIcon size={13} className="shrink-0 text-slate-400" />
              <span className="truncate">
                {matchContext(m)} · {reasonText(m.reason, m.result)}
              </span>
            </span>
          </span>
        </span>

        <span className="hidden shrink-0 flex-col items-end gap-0.5 text-xs font-semibold text-slate-400 sm:flex">
          <span className="inline-flex items-center gap-1">
            <GridIcon size={12} /> {m.boardSize}×{m.boardSize} · {m.moveCount} nước
          </span>
          <span className="inline-flex items-center gap-1">
            <ClockIcon size={12} /> {formatDuration(m.finishedAt - m.startedAt)}
          </span>
        </span>
        <span className="w-[74px] shrink-0 text-right text-xs font-bold text-slate-400">{relativeTime(m.finishedAt)}</span>
        <ChevronDownIcon size={18} className={cx('shrink-0 text-slate-300 transition-transform', open && 'rotate-180 text-brand-500')} />
      </button>

      {open && (
        <div className="animate-fade-up border-t border-slate-100 bg-slate-50/60 p-3 sm:p-4">
          <div className="mb-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs font-semibold text-slate-500">
            <span className="inline-flex items-center gap-1.5">
              Bạn cầm <MarkBadge mark={m.myMark} className="h-5 w-5 text-[11px]" /> ({m.myName})
            </span>
            <span className="sm:hidden">
              {m.boardSize}×{m.boardSize} · {m.moveCount} nước · {formatDuration(m.finishedAt - m.startedAt)}
            </span>
            <span>{Math.round(m.turnMs / 1000)}s mỗi lượt</span>
            <span>{new Date(m.finishedAt).toLocaleString('vi-VN', { dateStyle: 'medium', timeStyle: 'short' })}</span>
          </div>
          {detail ? (
            <MatchReplay match={detail} />
          ) : failed ? (
            <p className="text-center text-sm font-semibold text-red-500">Không tải được ván này.</p>
          ) : (
            <div className="flex justify-center py-8 text-brand-500">
              <Spinner className="h-6 w-6" />
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function EmptyHistory({ filtered }: { filtered: boolean }) {
  return (
    <div className="rounded-3xl border-2 border-dashed border-slate-200 bg-white/60 p-8 text-center">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-brand-50 text-brand-500">
        <HistoryIcon size={26} />
      </div>
      <p className="mt-3 font-display text-lg font-bold text-slate-700">{filtered ? 'Chưa có ván nào ở mục này' : 'Chưa có ván nào'}</p>
      <p className="mt-1 text-sm text-slate-500">Chơi một ván là lịch sử sẽ hiện ở đây, kèm bàn cờ để xem lại.</p>
    </div>
  );
}
