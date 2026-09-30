/**
 * Artwork skins for titles, found by file name in src/assets/titles/:
 *
 *   title_<id>_base.png|webp        static nameplate (required)
 *   title_<id>_overlay.webp|png     transparent animated layer, same canvas (optional)
 *   title_<id>_overlay_meta.json    canvas size, text safe zone, overlay blend (optional)
 *
 * Adding those files is all a title needs to switch from the CSS pill to its
 * artwork; the id is the server's title id. The text is never baked in: the
 * badge writes the name inside the safe zone.
 */

export interface TitleSkin {
  base: string;
  overlay: string | null;
  /** Width / height of the canvas. */
  aspect: number;
  /** Where the name goes, as fractions of the canvas. */
  zone: { x: number; y: number; w: number; h: number };
  /** Name colour for this plate; the stylesheet has a default (dark, for light plates). */
  textColor?: string;
  /** CSS text-shadow for the name, e.g. a dark outline on a dark plate. */
  textShadow?: string;
  /** How the overlay mixes with the base (CSS mix-blend-mode); normal when unset. */
  blend?: string;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The meta files come from more than one exporter, so every spelling seen so far is read. */
interface SkinMeta {
  canvas?: { width: number; height: number };
  dimensions?: { width: number; height: number };
  size?: { width: number; height: number };
  width?: number;
  height?: number;
  text_safe_zone?: Box;
  textSafeArea?: Box;
  text_color?: string;
  textColor?: string;
  textShadow?: string;
  overlayPlacement?: { blendMode?: string };
  overlay?: { textSafeArea?: Box; blendMode?: string };
}

const BLEND_MODES = new Set(['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity', 'plus-lighter']);

// Vite reads these options statically, so they are written out in each call.
const bases = import.meta.glob<string>('../../assets/titles/title_*_base.{png,webp}', { eager: true, query: '?url', import: 'default' });
const overlays = import.meta.glob<string>('../../assets/titles/title_*_overlay.{webp,png}', { eager: true, query: '?url', import: 'default' });
const metas = import.meta.glob<SkinMeta>('../../assets/titles/title_*_meta.json', { eager: true, import: 'default' });

const idOf = (path: string) => /title_(.+?)_(?:base|overlay|overlay_meta|meta)\.\w+$/.exec(path)?.[1] ?? null;

function byId<T>(files: Record<string, T>): Map<string, T> {
  const out = new Map<string, T>();
  for (const [path, value] of Object.entries(files)) {
    const id = idOf(path);
    if (id) out.set(id, value);
  }
  return out;
}

/** A plate without meta: a 4:1 canvas with the middle free for text. */
const DEFAULT_ASPECT = 4;
const DEFAULT_ZONE = { x: 0.2, y: 0.22, w: 0.6, h: 0.56 };

const SKINS: ReadonlyMap<string, TitleSkin> = (() => {
  const overlayById = byId(overlays);
  const metaById = byId(metas);
  const out = new Map<string, TitleSkin>();
  for (const [id, base] of byId(bases)) {
    const meta = metaById.get(id);
    const canvas = meta?.canvas ?? meta?.dimensions ?? meta?.size ?? (meta?.width && meta?.height ? { width: meta.width, height: meta.height } : undefined);
    const w = canvas?.width ?? 0;
    const h = canvas?.height ?? 0;
    const z = meta?.text_safe_zone ?? meta?.textSafeArea ?? meta?.overlay?.textSafeArea;
    const blend = meta?.overlayPlacement?.blendMode ?? meta?.overlay?.blendMode;
    out.set(id, {
      base,
      overlay: overlayById.get(id) ?? null,
      aspect: w > 0 && h > 0 ? w / h : DEFAULT_ASPECT,
      zone: z && w > 0 && h > 0 ? { x: z.x / w, y: z.y / h, w: z.width / w, h: z.height / h } : DEFAULT_ZONE,
      textColor: meta?.text_color ?? meta?.textColor,
      textShadow: meta?.textShadow,
      blend: blend && BLEND_MODES.has(blend) && blend !== 'normal' ? blend : undefined,
    });
  }
  return out;
})();

export const titleSkin = (id: string | null | undefined): TitleSkin | null => (id ? (SKINS.get(id) ?? null) : null);
