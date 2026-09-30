import type { VoiceApi } from '../../hooks/useVoiceChat';
import { cx } from '../../lib/cx';
import { HeadphonesIcon, HeadphonesOffIcon, MicIcon, MicOffIcon, PhoneOffIcon, RematchIcon } from '../icons';
import { Button, IconButton } from '../ui';

interface VoicePanelProps {
  voice: VoiceApi;
  opponentName: string | null;
  opponentOnline: boolean;
  canTalk: boolean;
  className?: string;
}

type Tone = 'idle' | 'busy' | 'live' | 'bad';

const pillTone: Record<Tone, string> = {
  idle: 'bg-slate-100 text-slate-500',
  busy: 'bg-amber-50 text-amber-600 ring-1 ring-amber-200',
  live: 'bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200',
  bad: 'bg-red-50 text-red-500 ring-1 ring-red-200',
};

function describe(voice: VoiceApi, opponent: string, opponentOnline: boolean, canTalk: boolean): { pill: string; tone: Tone; text: string } {
  switch (voice.status) {
    case 'requesting':
      return { pill: 'Xin quyền', tone: 'busy', text: 'Hãy cho phép trình duyệt dùng micro…' };
    case 'waiting':
      return {
        pill: 'Chờ',
        tone: 'busy',
        text: !opponentOnline ? `${opponent} đang mất kết nối.` : `Micro đã bật. Đang chờ ${opponent} bật voice…`,
      };
    case 'connecting':
      return { pill: 'Đang nối', tone: 'busy', text: `Đang kết nối voice với ${opponent}…` };
    case 'connected':
      return {
        pill: 'Đang gọi',
        tone: 'live',
        text: voice.remote.muted ? `Đã kết nối · ${opponent} đang tắt mic.` : `Đã kết nối với ${opponent}.`,
      };
    case 'failed':
      return { pill: 'Lỗi', tone: 'bad', text: 'Voice gặp sự cố, ván đấu vẫn tiếp tục bình thường.' };
    default:
      if (!canTalk) return { pill: 'Tắt', tone: 'idle', text: 'Cần có đối thủ trong phòng để dùng voice.' };
      if (voice.remote.enabled) return { pill: 'Tắt', tone: 'idle', text: `${opponent} đã bật voice. Bật mic để nói chuyện!` };
      return { pill: 'Tắt', tone: 'idle', text: 'Micro chỉ bật khi bạn bấm. Âm thanh truyền trực tiếp giữa hai người.' };
  }
}

export function VoicePanel({ voice, opponentName, opponentOnline, canTalk, className }: VoicePanelProps) {
  const opponent = opponentName ?? 'Đối thủ';
  const info = describe(voice, opponent, opponentOnline, canTalk);
  const invited = !voice.enabled && voice.remote.enabled && canTalk;

  return (
    <section aria-label="Voice chat" className={cx('rounded-3xl bg-white/90 p-3.5 shadow-soft ring-1 ring-slate-200/70', className)}>
      <div className="flex items-center gap-2">
        <MicIcon size={16} className="text-brand-500" />
        <h2 className="font-display text-[15px] font-bold text-slate-700">Voice chat</h2>
        <span className={cx('ml-auto rounded-full px-2 py-0.5 text-[11px] font-bold', pillTone[info.tone])}>{info.pill}</span>
      </div>
      <p className="mt-1 text-xs leading-snug font-semibold text-slate-500" aria-live="polite">
        {info.text}
      </p>
      {voice.error && (
        <p role="alert" className="mt-2 rounded-xl bg-orange-50 px-2.5 py-1.5 text-xs font-semibold text-orange-700 ring-1 ring-orange-200">
          {voice.error}
        </p>
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {!voice.enabled ? (
          <Button
            variant="primary"
            size="sm"
            className={cx('flex-1', invited && 'animate-pulse-soft')}
            icon={<MicIcon size={16} />}
            loading={voice.status === 'requesting'}
            disabled={!canTalk}
            onClick={voice.enable}
          >
            Bật voice
          </Button>
        ) : (
          <>
            <Button
              variant={voice.muted ? 'danger' : 'soft'}
              size="sm"
              className="flex-1"
              icon={voice.muted ? <MicOffIcon size={16} /> : <MicIcon size={16} />}
              aria-pressed={voice.muted}
              onClick={voice.toggleMute}
            >
              {voice.muted ? 'Bật mic' : 'Tắt mic'}
            </Button>
            <IconButton
              label={voice.opponentMuted ? `Nghe lại ${opponent}` : `Tắt tiếng ${opponent}`}
              aria-pressed={voice.opponentMuted}
              onClick={voice.toggleOpponentMuted}
              className={cx('h-9 w-9', voice.opponentMuted && 'bg-red-50! text-red-500! ring-red-200!')}
            >
              {voice.opponentMuted ? <HeadphonesOffIcon size={17} /> : <HeadphonesIcon size={17} />}
            </IconButton>
            {voice.status === 'failed' && (
              <IconButton label="Thử kết nối lại" onClick={voice.retry} className="h-9 w-9">
                <RematchIcon size={17} />
              </IconButton>
            )}
            <IconButton label="Tắt voice" onClick={voice.disable} className="h-9 w-9 hover:text-red-500!">
              <PhoneOffIcon size={17} />
            </IconButton>
          </>
        )}
      </div>

      {voice.enabled && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          <SpeakerChip label="Bạn" speaking={voice.localSpeaking} muted={voice.muted} />
          <SpeakerChip
            label={opponent}
            speaking={voice.status === 'connected' && voice.remoteSpeaking}
            muted={voice.remote.muted}
            off={!voice.remote.enabled}
            silenced={voice.opponentMuted}
          />
        </div>
      )}
    </section>
  );
}

function SpeakerChip({ label, speaking, muted, off, silenced }: { label: string; speaking: boolean; muted: boolean; off?: boolean; silenced?: boolean }) {
  return (
    <span
      className={cx(
        'inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-bold transition-colors',
        speaking ? 'bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200' : 'bg-slate-100 text-slate-500',
      )}
    >
      {muted || off ? <MicOffIcon size={12} /> : <SpeakingBars active={speaking} />}
      <span className="truncate">{label}</span>
      <span className="shrink-0 font-semibold opacity-80">
        {off ? '· chưa bật' : muted ? '· tắt mic' : speaking ? '· đang nói' : silenced ? '· đã tắt tiếng' : ''}
      </span>
    </span>
  );
}

/** Three little bars that bounce while someone is talking. */
export function SpeakingBars({ active, className }: { active: boolean; className?: string }) {
  return (
    <span className={cx('inline-flex h-3 items-end gap-[2px]', className)} aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={cx('w-[3px] rounded-full bg-current', active ? 'animate-bounce-dot' : 'h-1 opacity-60')}
          style={active ? { height: `${[8, 12, 7][i]}px`, animationDelay: `${i * 0.12}s`, animationDuration: '0.7s' } : undefined}
        />
      ))}
    </span>
  );
}
