import { useState } from 'react';
import { equipTitle, useEquippedTitle } from '../../lib/account';
import { cx } from '../../lib/cx';
import { CheckIcon } from '../icons';
import { useToast } from '../Toasts';
import { Button } from '../ui';

/**
 * "Trang bị" / "Đang sử dụng" for one owned title. Asks the server (which
 * checks ownership) and updates every screen from its answer, no reload.
 */
export function EquipTitleButton({
  titleId,
  titleName,
  size = 'sm',
  allowUnequip = true,
  autoFocus,
  className,
  onEquipped,
}: {
  titleId: string;
  titleName: string;
  size?: 'sm' | 'md';
  /** Show "Tháo" next to "Đang sử dụng". */
  allowUnequip?: boolean;
  autoFocus?: boolean;
  className?: string;
  onEquipped?: () => void;
}) {
  const equipped = useEquippedTitle();
  const toast = useToast();
  const [busy, setBusy] = useState<'equip' | 'unequip' | null>(null);
  const isOn = equipped?.id === titleId;

  const run = async (next: string | null) => {
    setBusy(next ? 'equip' : 'unequip');
    const res = await equipTitle(next);
    setBusy(null);
    if (!res.ok) return toast(res.message, 'error');
    toast(next ? `Đã trang bị danh hiệu “${titleName}”.` : 'Đã tháo danh hiệu.', 'success');
    if (next) onEquipped?.();
  };

  if (isOn) {
    return (
      <div className={cx('flex items-center gap-1.5', className)}>
        <span className="inline-flex h-8 items-center gap-1 rounded-xl bg-emerald-50 px-2.5 text-xs font-extrabold text-emerald-700 ring-1 ring-emerald-200">
          <CheckIcon size={14} strokeWidth={3} /> Đang sử dụng
        </span>
        {allowUnequip && (
          <Button variant="ghost" size="sm" className="h-8 px-2.5 text-xs" loading={busy === 'unequip'} onClick={() => void run(null)}>
            Tháo
          </Button>
        )}
      </div>
    );
  }
  return (
    <Button
      variant="primary"
      size={size}
      className={cx(size === 'sm' && 'h-8 px-3 text-xs', className)}
      loading={busy === 'equip'}
      onClick={() => void run(titleId)}
      autoFocus={autoFocus}
    >
      {equipped ? 'Đổi sang' : 'Trang bị'}
    </Button>
  );
}
