import { useState } from 'react';
import { cx } from '../lib/cx';
import { inviteLink } from '../lib/env';
import { copyText, shareLink } from '../lib/share';
import { CheckIcon, CopyIcon, LinkIcon, ShareIcon } from './icons';
import { useToast } from './Toasts';
import { Button } from './ui';

/** `link` overrides the room invite link (e.g. a tournament lobby). */
export function useCopyInvite(roomId: string, link?: string) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    const ok = await copyText(link ?? inviteLink(roomId));
    toast(ok ? 'Đã sao chép link mời!' : 'Không thể sao chép — hãy chọn link và sao chép thủ công.', ok ? 'success' : 'error');
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    }
  };
  return { copied, copy };
}

export function InvitePanel({
  roomId,
  className,
  link: customLink,
  shareText = 'Vào chơi cờ caro với mình nhé!',
}: {
  roomId: string;
  className?: string;
  link?: string;
  shareText?: string;
}) {
  const toast = useToast();
  const { copied, copy } = useCopyInvite(roomId, customLink);
  const link = customLink ?? inviteLink(roomId);

  const share = async () => {
    const outcome = await shareLink(link, shareText);
    if (outcome === 'copied') toast('Trình duyệt không hỗ trợ chia sẻ — đã sao chép link.', 'success');
    if (outcome === 'failed') toast('Không thể chia sẻ link.', 'error');
  };

  return (
    <div className={cx('w-full', className)}>
      <label htmlFor={`invite-${roomId}`} className="mb-1.5 block text-left text-xs font-bold tracking-wide text-slate-400 uppercase">
        Link mời
      </label>
      <div className="flex items-center gap-2 rounded-2xl bg-slate-50 p-1.5 pl-3 ring-1 ring-slate-200">
        <LinkIcon size={16} className="shrink-0 text-brand-400" />
        <input
          id={`invite-${roomId}`}
          readOnly
          value={link}
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-slate-600 outline-none"
        />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button variant="primary" onClick={copy} icon={copied ? <CheckIcon size={18} /> : <CopyIcon size={18} />}>
          {copied ? 'Đã sao chép!' : 'Sao chép link'}
        </Button>
        <Button variant="secondary" onClick={share} icon={<ShareIcon size={18} />}>
          Chia sẻ
        </Button>
      </div>
    </div>
  );
}
