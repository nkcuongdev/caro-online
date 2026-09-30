import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { uploadAvatar } from '../lib/api';
import {
  AVATAR_ACCEPT,
  AVATAR_INPUT_MAX_MB,
  AVATAR_OUTPUT_SIZE,
  AVATAR_PRESETS,
  checkAvatarFile,
  getLastUploadedAvatar,
  isUploadedAvatar,
  presetAvatar,
  presetId,
  setMyAvatar,
  useMyAvatar,
} from '../lib/avatar';
import { useMyAvatarFrame } from '../lib/account';
import { cx } from '../lib/cx';
import { AvatarImage } from './Avatar';
import { AvatarWithFrame } from './AvatarWithFrame';
import { CameraIcon, CheckIcon, CloseIcon, MinusIcon, PlusIcon, UploadIcon } from './icons';
import { Modal } from './Modal';
import { Button } from './ui';

interface AvatarPickerProps {
  open: boolean;
  /** The avatar in use now. */
  current: string;
  /** For the fallback shown if an image can't load (usually the player id). */
  seed: string;
  onClose: () => void;
  /** Return `false` to keep the dialog open (e.g. the server rejected the change). */
  onSave: (avatar: string) => void | boolean | Promise<void | boolean>;
}

/** Choose a bundled avatar or upload a photo (cropped to a 256×256 square in the browser). */
export function AvatarPicker(props: AvatarPickerProps) {
  // Mounted only while open, so every opening starts fresh.
  return props.open ? <PickerDialog {...props} /> : null;
}

/** This browser's avatar with a change button, for screens outside a room (lobby, invite). */
export function MyAvatarButton({ seed, className }: { seed: string; className?: string }) {
  const avatar = useMyAvatar();
  const frame = useMyAvatarFrame();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Đổi avatar"
        title="Đổi avatar"
        className={cx('group relative shrink-0 rounded-2xl focus-visible:ring-4 focus-visible:ring-brand-200 focus-visible:outline-none', className)}
      >
        <AvatarWithFrame
          avatar={avatar}
          frameId={frame}
          seed={seed}
          name="Bạn"
          className="h-full w-full rounded-2xl bg-brand-50 ring-1 ring-brand-100 transition-transform duration-150 group-hover:-translate-y-0.5"
        />
        <span className="absolute -right-1 -bottom-1 grid h-6 w-6 place-items-center rounded-full bg-white text-brand-500 shadow-sm ring-1 ring-slate-200 transition-colors group-hover:bg-brand-500 group-hover:text-white">
          <CameraIcon size={13} />
        </span>
      </button>
      <AvatarPicker open={open} current={avatar} seed={seed} onClose={() => setOpen(false)} onSave={setMyAvatar} />
    </>
  );
}

type Tab = 'preset' | 'upload';

function PickerDialog({ current, seed, onClose, onSave }: AvatarPickerProps) {
  const [uploaded] = useState(() => (isUploadedAvatar(current) ? current : getLastUploadedAvatar()));
  const [selected, setSelected] = useState(current);
  const [tab, setTab] = useState<Tab>('preset');
  const [file, setFile] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const cropper = useRef<CropperHandle>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => () => void (file && URL.revokeObjectURL(file)), [file]);

  const pickFile = (f: File | undefined) => {
    if (!f) return;
    const problem = checkAvatarFile(f);
    setError(problem);
    if (problem) return;
    setFile(URL.createObjectURL(f));
    setTab('upload');
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    pickFile(e.dataTransfer.files[0]);
  };

  const canSave = !saving && (tab === 'preset' ? selected !== current : !!file);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      let value = selected;
      if (tab === 'upload') {
        if (!cropper.current) return;
        const res = await uploadAvatar(await cropper.current.export());
        if (!res.ok) {
          setError(res.message);
          return;
        }
        value = res.avatar;
      }
      if ((await onSave(value)) !== false) onClose();
    } catch {
      setError('Không xử lý được ảnh này, hãy thử ảnh khác.');
    } finally {
      setSaving(false);
    }
  };

  const tile = (value: string, label: string) => {
    const active = selected === value;
    return (
      <button
        key={value}
        type="button"
        onClick={() => setSelected(value)}
        aria-pressed={active}
        aria-label={label}
        title={label}
        className={cx(
          'group relative aspect-square rounded-2xl p-1 transition-all duration-150 focus-visible:ring-4 focus-visible:ring-brand-200 focus-visible:outline-none',
          active ? 'bg-brand-100 ring-2 ring-brand-500' : 'bg-slate-50 ring-1 ring-slate-200 hover:-translate-y-0.5 hover:ring-brand-200',
        )}
      >
        <AvatarImage avatar={value} seed={seed} name={label} className="h-full w-full rounded-xl bg-transparent" />
        {active && (
          <span className="animate-pop-in absolute -top-1.5 -right-1.5 grid h-5 w-5 place-items-center rounded-full bg-brand-500 text-white ring-2 ring-white">
            <CheckIcon size={12} strokeWidth={3} />
          </span>
        )}
      </button>
    );
  };

  return (
    <Modal open onClose={saving ? undefined : onClose} labelledBy="avatar-title" className="max-w-md!">
      <button
        type="button"
        onClick={onClose}
        disabled={saving}
        className="absolute top-4 right-4 rounded-xl p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
        aria-label="Đóng"
      >
        <CloseIcon size={18} />
      </button>
      <h2 id="avatar-title" className="font-display text-xl font-bold text-slate-800">
        Chọn avatar
      </h2>
      <p className="mt-0.5 text-sm text-slate-500">Đối thủ và người xem sẽ thấy ngay khi bạn đổi.</p>

      <div role="tablist" aria-label="Nguồn avatar" className="mt-4 grid grid-cols-2 gap-1 rounded-2xl bg-slate-100 p-1">
        {(['preset', 'upload'] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => {
              setTab(t);
              setError(null);
            }}
            className={cx(
              'h-9 rounded-xl font-display text-sm font-semibold transition-all',
              tab === t ? 'bg-white text-brand-600 shadow-soft' : 'text-slate-500 hover:text-slate-700',
            )}
          >
            {t === 'preset' ? 'Có sẵn' : 'Tải ảnh lên'}
          </button>
        ))}
      </div>

      <div className="mt-4 min-h-[272px]">
        {tab === 'preset' ? (
          <div role="tabpanel" className="grid grid-cols-4 gap-2.5">
            {uploaded && tile(uploaded, 'Ảnh của bạn')}
            {AVATAR_PRESETS.map((p) => tile(presetAvatar(p.id), p.label))}
          </div>
        ) : file ? (
          <div role="tabpanel">
            <Cropper
              ref={cropper}
              src={file}
              onError={(message) => {
                setError(message);
                setFile(null);
              }}
            />
            <button
              type="button"
              onClick={() => input.current?.click()}
              className="mx-auto mt-2 block text-sm font-semibold text-slate-400 transition-colors hover:text-brand-600"
            >
              Chọn ảnh khác
            </button>
          </div>
        ) : (
          <button
            type="button"
            role="tabpanel"
            onClick={() => input.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            className={cx(
              'flex h-[272px] w-full flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed text-center transition-colors',
              dragOver ? 'border-brand-400 bg-brand-50' : 'border-slate-200 bg-slate-50/60 hover:border-brand-300 hover:bg-brand-50/50',
            )}
          >
            <span className="grid h-14 w-14 place-items-center rounded-2xl bg-white text-brand-500 shadow-soft ring-1 ring-slate-200">
              <UploadIcon size={26} />
            </span>
            <span className="font-display font-semibold text-slate-700">Chọn ảnh từ máy</span>
            <span className="text-xs font-semibold text-slate-400">
              hoặc kéo thả vào đây · JPG, PNG, WebP · tối đa {AVATAR_INPUT_MAX_MB} MB
            </span>
          </button>
        )}
      </div>

      <input
        ref={input}
        type="file"
        accept={AVATAR_ACCEPT}
        className="hidden"
        onChange={(e) => {
          pickFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />

      {error && (
        <p role="alert" className="animate-fade-in mt-3 text-center text-sm font-semibold text-red-500">
          {error}
        </p>
      )}

      <div className="mt-5 grid grid-cols-2 gap-2">
        <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
          Hủy
        </Button>
        <Button type="button" variant="primary" onClick={save} disabled={!canSave} loading={saving} icon={<CheckIcon size={18} />}>
          {saving && tab === 'upload' ? 'Đang tải…' : 'Lưu avatar'}
        </Button>
      </div>
      <p className="sr-only" aria-live="polite">
        {tab === 'preset' && presetId(selected) ? `Đã chọn ${AVATAR_PRESETS.find((p) => p.id === presetId(selected))?.label}` : ''}
      </p>
    </Modal>
  );
}

// ─── Cropper ─────────────────────────────────────────────────────────────────

interface CropperHandle {
  /** The visible square as a 256×256 WebP (PNG where the browser can't encode WebP). */
  export(): Promise<Blob>;
}

/** Side of the crop area, in CSS px. */
const VIEW = 224;
const MAX_ZOOM = 4;
const MIN_SIDE = 32;

interface Crop {
  zoom: number;
  /** Centre of the visible square, in image pixels. */
  cx: number;
  cy: number;
}

const Cropper = forwardRef<CropperHandle, { src: string; onError: (message: string) => void }>(function Cropper({ src, onError }, ref) {
  const img = useRef<HTMLImageElement>(null);
  const view = useRef<HTMLDivElement>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [crop, setCrop] = useState<Crop>({ zoom: 1, cx: 0, cy: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ crop: Crop; x: number; y: number; dist: number } | null>(null);

  /** Keeps the square inside the image at the given zoom. */
  const clamp = (c: Crop): Crop => {
    if (!natural) return c;
    const zoom = Math.min(MAX_ZOOM, Math.max(1, c.zoom));
    const half = Math.min(natural.w, natural.h) / zoom / 2;
    return {
      zoom,
      cx: Math.min(natural.w - half, Math.max(half, c.cx)),
      cy: Math.min(natural.h - half, Math.max(half, c.cy)),
    };
  };
  const scale = natural ? (VIEW / Math.min(natural.w, natural.h)) * crop.zoom : 1;

  useImperativeHandle(ref, () => ({
    async export() {
      const el = img.current;
      if (!el || !natural) throw new Error('image not ready');
      const side = Math.min(natural.w, natural.h) / crop.zoom;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = AVATAR_OUTPUT_SIZE;
      const ctx = canvas.getContext('2d')!;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(el, crop.cx - side / 2, crop.cy - side / 2, side, side, 0, 0, AVATAR_OUTPUT_SIZE, AVATAR_OUTPUT_SIZE);
      const webp = await toBlob(canvas, 'image/webp', 0.9);
      const blob = webp?.type === 'image/webp' ? webp : await toBlob(canvas, 'image/png');
      if (!blob) throw new Error('encode failed');
      return blob;
    },
  }));

  // Wheel zoom needs a non-passive listener to stop the page from scrolling.
  useEffect(() => {
    const el = view.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setCrop((c) => clamp({ ...c, zoom: c.zoom * Math.exp(-e.deltaY * 0.0015) }));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  const distance = () => {
    const [a, b] = [...pointers.current.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  const startGesture = () => {
    const pts = [...pointers.current.values()];
    const x = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const y = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    gesture.current = { crop, x, y, dist: distance() };
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    startGesture();
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId) || !gesture.current || !natural) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    const pts = [...pointers.current.values()];
    const x = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const y = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const zoom = g.dist && pts.length > 1 ? g.crop.zoom * (distance() / g.dist) : g.crop.zoom;
    const s = (VIEW / Math.min(natural.w, natural.h)) * zoom;
    setCrop(clamp({ zoom, cx: g.crop.cx - (x - g.x) / s, cy: g.crop.cy - (y - g.y) / s }));
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size) startGesture();
    else gesture.current = null;
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const step = 12 / scale;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const zooms: Record<string, number> = { '+': 1.1, '=': 1.1, '-': 1 / 1.1 };
    if (moves[e.key]) setCrop((c) => clamp({ ...c, cx: c.cx + moves[e.key][0], cy: c.cy + moves[e.key][1] }));
    else if (zooms[e.key]) setCrop((c) => clamp({ ...c, zoom: c.zoom * zooms[e.key] }));
    else return;
    e.preventDefault();
  };

  const onLoad = () => {
    const el = img.current!;
    const w = el.naturalWidth;
    const h = el.naturalHeight;
    if (Math.min(w, h) < MIN_SIDE) return onError(`Ảnh quá nhỏ, cần ít nhất ${MIN_SIDE}×${MIN_SIDE} px.`);
    setNatural({ w, h });
    setCrop({ zoom: 1, cx: w / 2, cy: h / 2 });
  };

  const layer = (size: number) =>
    natural && {
      width: natural.w * scale * (size / VIEW),
      height: natural.h * scale * (size / VIEW),
      transform: `translate(${(VIEW / 2 - crop.cx * scale) * (size / VIEW)}px, ${(VIEW / 2 - crop.cy * scale) * (size / VIEW)}px)`,
    };

  return (
    <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start sm:justify-center sm:gap-4">
      <div
        ref={view}
        tabIndex={0}
        role="application"
        aria-label="Vùng cắt ảnh. Kéo để di chuyển, cuộn hoặc chụm hai ngón để phóng to. Phím mũi tên để di chuyển, + và − để phóng to."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        className="relative shrink-0 cursor-grab touch-none overflow-hidden rounded-[28px] bg-[repeating-conic-gradient(#f1f5f9_0_25%,#fff_0_50%)] bg-[length:16px_16px] ring-1 ring-slate-200 outline-none focus-visible:ring-4 focus-visible:ring-brand-200 active:cursor-grabbing"
        style={{ width: VIEW, height: VIEW }}
      >
        <img
          ref={img}
          src={src}
          alt=""
          draggable={false}
          onLoad={onLoad}
          onError={() => onError('Không đọc được ảnh này, hãy thử ảnh khác.')}
          className={cx('absolute top-0 left-0 max-w-none origin-top-left select-none', !natural && 'invisible')}
          style={layer(VIEW) ?? undefined}
        />
        {/* Rule-of-thirds guide. */}
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,transparent_33.2%,rgb(255_255_255/0.5)_33.3%,transparent_33.4%,transparent_66.6%,rgb(255_255_255/0.5)_66.7%,transparent_66.8%),linear-gradient(to_bottom,transparent_33.2%,rgb(255_255_255/0.5)_33.3%,transparent_33.4%,transparent_66.6%,rgb(255_255_255/0.5)_66.7%,transparent_66.8%)]" />
      </div>

      <div className="flex w-full max-w-[224px] flex-col gap-3 sm:w-[148px] sm:pt-1">
        <div className="flex items-end justify-center gap-3 sm:justify-start">
          {[64, 40].map((size) => (
            <div key={size} className="flex flex-col items-center gap-1">
              <div className="relative overflow-hidden rounded-2xl bg-slate-100 ring-1 ring-slate-200" style={{ width: size, height: size }}>
                {natural && <img src={src} alt="" draggable={false} className="absolute top-0 left-0 max-w-none" style={layer(size) ?? undefined} />}
              </div>
              <span className="text-[10px] font-bold text-slate-400">{size}px</span>
            </div>
          ))}
        </div>
        <label className="flex items-center gap-2 text-slate-400">
          <MinusIcon size={14} />
          <span className="sr-only">Thu phóng</span>
          <input
            type="range"
            min={1}
            max={MAX_ZOOM}
            step={0.01}
            value={crop.zoom}
            disabled={!natural}
            onChange={(e) => setCrop((c) => clamp({ ...c, zoom: Number(e.target.value) }))}
            className="h-1.5 flex-1 cursor-pointer accent-brand-500"
          />
          <PlusIcon size={14} />
        </label>
        <p className="text-center text-xs font-semibold text-slate-400 sm:text-left">Kéo ảnh để căn chỉnh</p>
      </div>
    </div>
  );
});

const toBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
