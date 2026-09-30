import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { cx } from '../lib/cx';
import type { Mark } from '../lib/protocol';
import { Cell } from './Cell';
import { FitIcon, MinusIcon, PlusIcon } from './icons';

interface GameBoardProps {
  board: string;
  size: number;
  winLine: number[] | null;
  lastMove: number | null;
  /** Mark to preview on hover; null when the local player can't move right now. */
  ghostMark: Mark | null;
  pendingIndex: number | null;
  onCellClick: (index: number) => void;
  /** Cell to keep in view on small screens (the opponent's latest move). */
  followIndex: number | null;
  overlay?: ReactNode;
  className?: string;
}

/** Zoom multipliers over the default cell size; 0 = shrink to fit the whole board. */
const ZOOM_LEVELS = [0, 1, 1.25, 1.5, 1.8];
const DEFAULT_ZOOM = 1;
const ZOOM_KEY = 'caro:zoom';
const FRAME_PAD = 8;
const MIN_CELL = 40;
const MAX_CELL = 64;

function loadZoom() {
  try {
    const v = Number(localStorage.getItem(ZOOM_KEY) ?? DEFAULT_ZOOM);
    return Number.isInteger(v) && v >= 0 && v < ZOOM_LEVELS.length ? v : DEFAULT_ZOOM;
  } catch {
    return DEFAULT_ZOOM;
  }
}

export function GameBoard({ board, size, winLine, lastMove, ghostMark, pendingIndex, onCellClick, followIndex, overlay, className }: GameBoardProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(loadZoom);
  const [focusIndex, setFocusIndex] = useState(() => Math.floor(size / 2) * size + Math.floor(size / 2));

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // Measure synchronously too: ResizeObserver only reports on the next painted frame.
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(ZOOM_KEY, String(zoom));
    } catch {
      /* storage unavailable: zoom just isn't remembered */
    }
  }, [zoom]);

  // Cell size: fill the available space, but never below a comfortable size.
  // If that doesn't fit, the board pans inside its own scroll area.
  const chrome = FRAME_PAD * 2 + 2 + (size - 1);
  const fit = box.w ? Math.floor((Math.min(box.w, box.h) - chrome) / size) : 0;
  const base = Math.min(Math.max(fit, MIN_CELL), MAX_CELL);
  const factor = ZOOM_LEVELS[zoom];
  const cell = factor === 0 ? Math.max(Math.min(fit, MAX_CELL), 12) : Math.round(base * factor);
  const boardPx = cell * size + chrome;
  const overflows = boardPx > box.w + 1 || boardPx > box.h + 1;

  const winSet = useMemo(() => new Set(winLine ?? []), [winLine]);

  // Keep the same spot centered when the cell size changes (zoom, resize).
  // Starts at the middle of the board, where most games begin.
  const viewCenter = useRef({ x: 0.5, y: 0.5 });
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    viewCenter.current = {
      x: (el.scrollLeft + el.clientWidth / 2) / el.scrollWidth,
      y: (el.scrollTop + el.clientHeight / 2) / el.scrollHeight,
    };
  };
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const { x, y } = viewCenter.current;
    el.scrollLeft = x * el.scrollWidth - el.clientWidth / 2;
    el.scrollTop = y * el.scrollHeight - el.clientHeight / 2;
  }, [cell]);

  // Pan to the opponent's move if it landed off-screen.
  useEffect(() => {
    if (followIndex === null || !overflows) return;
    const scroller = scrollRef.current;
    const target = gridRef.current?.querySelector<HTMLElement>(`[data-index="${followIndex}"]`);
    if (!scroller || !target) return;
    const s = scroller.getBoundingClientRect();
    const c = target.getBoundingClientRect();
    const margin = cell;
    const outside = c.left < s.left + margin || c.right > s.right - margin || c.top < s.top + margin || c.bottom > s.bottom - margin;
    if (outside) {
      scroller.scrollBy({
        left: c.left - s.left - s.width / 2 + c.width / 2,
        top: c.top - s.top - s.height / 2 + c.height / 2,
        behavior: 'smooth',
      });
    }
  }, [followIndex, overflows, cell]);

  const handleClick = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-index]');
      if (!el) return;
      const index = Number(el.dataset.index);
      setFocusIndex(index);
      onCellClick(index);
    },
    [onCellClick],
  );

  // Roving focus: arrow keys move between cells, Enter/Space plays.
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const deltas: Record<string, number> = { ArrowUp: -size, ArrowDown: size, ArrowLeft: -1, ArrowRight: 1 };
    const d = deltas[e.key];
    if (d === undefined) return;
    e.preventDefault();
    const row = Math.floor(focusIndex / size);
    const col = focusIndex % size;
    if ((e.key === 'ArrowLeft' && col === 0) || (e.key === 'ArrowRight' && col === size - 1)) return;
    const next = focusIndex + d;
    if (next < 0 || next >= size * size || (d === -size && row === 0)) return;
    setFocusIndex(next);
    gridRef.current?.querySelector<HTMLElement>(`[data-index="${next}"]`)?.focus();
  };

  const cells = [];
  for (let i = 0; i < size * size; i++) {
    const ch = board[i];
    const value: Mark | null = ch === 'X' || ch === 'O' ? ch : null;
    cells.push(
      <Cell
        key={i}
        index={i}
        row={Math.floor(i / size)}
        col={i % size}
        value={value}
        size={cell}
        isWin={winSet.has(i)}
        isLast={lastMove === i}
        ghost={ghostMark}
        pending={pendingIndex === i}
        focusable={focusIndex === i}
      />,
    );
  }

  return (
    <div ref={containerRef} className={cx('relative min-h-0 w-full', className)}>
      <div ref={scrollRef} onScroll={onScroll} className="board-scroll absolute inset-0 flex overflow-auto">
        <div className="m-auto p-px">
          <div className="rounded-[22px] bg-white p-2 shadow-soft ring-1 ring-slate-200/70">
            <div
              ref={gridRef}
              role="grid"
              aria-label={`Bàn cờ caro ${size}×${size}`}
              onClick={handleClick}
              onKeyDown={handleKeyDown}
              className="grid gap-px overflow-hidden rounded-[14px] border border-slate-200 bg-slate-200/90"
              style={{ gridTemplateColumns: `repeat(${size}, ${cell}px)` }}
            >
              {cells}
            </div>
          </div>
        </div>
      </div>

      {!overlay && (
        <div className="absolute right-2 bottom-2 z-10 flex items-center gap-0.5 rounded-2xl bg-white/95 p-1 shadow-soft ring-1 ring-slate-200/80">
          <ZoomButton label="Thu nhỏ" disabled={zoom === 0} onClick={() => setZoom((z) => Math.max(0, z - 1))}>
            <MinusIcon size={16} />
          </ZoomButton>
          <span className="tabular w-11 text-center text-xs font-bold text-slate-500" aria-live="polite">
            {factor === 0 ? 'Vừa' : `${Math.round(factor * 100)}%`}
          </span>
          <ZoomButton label="Phóng to" disabled={zoom === ZOOM_LEVELS.length - 1} onClick={() => setZoom((z) => Math.min(ZOOM_LEVELS.length - 1, z + 1))}>
            <PlusIcon size={16} />
          </ZoomButton>
          <ZoomButton
            label={factor === 0 ? 'Kích thước mặc định' : 'Vừa màn hình'}
            active={factor === 0}
            onClick={() => setZoom((z) => (ZOOM_LEVELS[z] === 0 ? DEFAULT_ZOOM : 0))}
          >
            <FitIcon size={16} />
          </ZoomButton>
        </div>
      )}

      {overlay && <div className="absolute inset-0 z-20 flex items-center justify-center p-3">{overlay}</div>}
    </div>
  );
}

function ZoomButton({ label, active, disabled, onClick, children }: { label: string; active?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'grid h-8 w-8 place-items-center rounded-xl text-slate-500 transition-colors hover:bg-brand-50 hover:text-brand-600 disabled:opacity-30',
        active && 'bg-brand-50 text-brand-600',
      )}
    >
      {children}
    </button>
  );
}
