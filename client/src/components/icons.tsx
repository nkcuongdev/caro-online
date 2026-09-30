import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 20, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const CopyIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="9" y="9" width="12" height="12" rx="3" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </Icon>
);
export const CheckIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M20 6 9 17l-5-5" />
  </Icon>
);
export const ShareIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="18" cy="5" r="3" />
    <circle cx="6" cy="12" r="3" />
    <circle cx="18" cy="19" r="3" />
    <path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4" />
  </Icon>
);
export const LinkIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
    <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
  </Icon>
);
export const VolumeOnIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M11 5 6 9H2v6h4l5 4V5Z" />
    <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" />
  </Icon>
);
export const VolumeOffIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M11 5 6 9H2v6h4l5 4V5Z" />
    <path d="m22 9-6 6M16 9l6 6" />
  </Icon>
);
export const LogOutIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="m16 17 5-5-5-5M21 12H9" />
  </Icon>
);
export const FlagIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 22V4M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1" />
  </Icon>
);
export const RematchIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 12a9 9 0 0 1 15.5-6.2L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 0 1-15.5 6.2L3 16" />
    <path d="M3 21v-5h5" />
  </Icon>
);
export const UsersIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" />
  </Icon>
);
export const ZapIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z" />
  </Icon>
);
export const TimerIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="13" r="8" />
    <path d="M12 9v4l2 2M9 2h6" />
  </Icon>
);
export const SparkIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
  </Icon>
);
export const TrophyIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4Z" />
    <path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3" />
  </Icon>
);
export const WifiOffIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2 2l20 20M8.5 16.5a5 5 0 0 1 7 0M5 12.9a10 10 0 0 1 5.2-2.8M19 12.9a10 10 0 0 0-2.2-1.6M2 8.8a15 15 0 0 1 4.2-2.6M22 8.8A15 15 0 0 0 11 5" />
    <path d="M12 20h.01" />
  </Icon>
);
export const PlusIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);
export const MinusIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 12h14" />
  </Icon>
);
export const FitIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" />
  </Icon>
);
export const ArrowRightIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 12h14M13 5l7 7-7 7" />
  </Icon>
);
export const EyeIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
    <circle cx="12" cy="12" r="3" />
  </Icon>
);
export const PencilIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3Z" />
  </Icon>
);
export const HomeIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m3 10 9-7 9 7v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V10Z" />
    <path d="M9 22V12h6v10" />
  </Icon>
);
export const BookIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2Z" />
    <path d="M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7Z" />
  </Icon>
);
export const CloseIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M18 6 6 18M6 6l12 12" />
  </Icon>
);
export const MicIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="9" y="2" width="6" height="12" rx="3" />
    <path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4M8 22h8" />
  </Icon>
);
export const MicOffIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m2 2 20 20" />
    <path d="M15 9.3V5a3 3 0 0 0-5.7-1.3M9 9v2a3 3 0 0 0 5.1 2.1" />
    <path d="M19 10v1a7 7 0 0 1-.9 3.4M16.9 16.9A7 7 0 0 1 5 11v-1M12 18v4M8 22h8" />
  </Icon>
);
export const HeadphonesIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
    <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3v5ZM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3v5Z" />
  </Icon>
);
export const HeadphonesOffIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m2 2 20 20" />
    <path d="M3 18v-6a9 9 0 0 1 2.6-6.4M8.5 3.7A9 9 0 0 1 21 12v4.5" />
    <path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5Z" />
  </Icon>
);
export const PhoneOffIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10.7 13.3a16 16 0 0 0 3 2.3l1.3-1.3a2 2 0 0 1 2.1-.4c.8.3 1.7.5 2.6.6A2 2 0 0 1 21.5 16.5v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-3.5-2.9M5.2 13.4A19.8 19.8 0 0 1 2.5 4.7 2 2 0 0 1 4.5 2.5h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.6a2 2 0 0 1-.4 2.1L8.4 10.2" />
    <path d="m22 2-20 20" />
  </Icon>
);
export const ChatIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M21 12a8 8 0 0 1-11.7 7.1L3 21l1.9-6.3A8 8 0 1 1 21 12Z" />
  </Icon>
);
export const SendIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z" />
  </Icon>
);
export const SmileIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="10" />
    <path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01" />
  </Icon>
);
export const HandshakeIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m11 17 2 2a1 1 0 1 0 3-3" />
    <path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.9-3.9a3 3 0 0 0-4.2 0l-.9.9a1 1 0 1 1-3-3l2.8-2.8a5.8 5.8 0 0 1 7.1-.9l.5.3a2 2 0 0 0 1.4.2L21 4" />
    <path d="m21 3 1 11h-2M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3M3 4h8" />
  </Icon>
);
export const BotIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="4" y="8" width="16" height="12" rx="4" />
    <path d="M12 8V4M9 4h6M9 13v1M15 13v1M2 13v2M22 13v2" />
  </Icon>
);
export const CameraIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z" />
    <circle cx="12" cy="13" r="3.5" />
  </Icon>
);
export const UploadIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
  </Icon>
);
export const DiceIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="3" width="18" height="18" rx="4" />
    <circle cx="8.5" cy="8.5" r="1" fill="currentColor" />
    <circle cx="15.5" cy="8.5" r="1" fill="currentColor" />
    <circle cx="12" cy="12" r="1" fill="currentColor" />
    <circle cx="8.5" cy="15.5" r="1" fill="currentColor" />
    <circle cx="15.5" cy="15.5" r="1" fill="currentColor" />
  </Icon>
);
export const StickerIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M15.5 3H6a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3h7l8-8V6a3 3 0 0 0-3-3h-2.5Z" />
    <path d="M13 21v-5a3 3 0 0 1 3-3h5" />
    <path d="M8.5 9.5h.01M13.5 9.5h.01" />
  </Icon>
);
export const UserIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21a8 8 0 0 1 16 0" />
  </Icon>
);
export const MailIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="5" width="18" height="14" rx="3" />
    <path d="m4 7 8 6 8-6" />
  </Icon>
);
export const LockIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="4" y="11" width="16" height="10" rx="3" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </Icon>
);
export const EyeOffIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10.6 5.1A10.8 10.8 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.2M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6" />
    <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18" />
  </Icon>
);
export const ChartIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
  </Icon>
);
export const HistoryIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <path d="M3 3v5h5M12 7v5l3 2" />
  </Icon>
);
export const ChevronDownIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m6 9 6 6 6-6" />
  </Icon>
);
export const ArrowLeftIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M19 12H5M12 19l-7-7 7-7" />
  </Icon>
);
export const FireIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 22c4 0 7-2.7 7-7 0-3.5-2.2-6.3-4-8-.3 2-1.3 3.4-2.6 4C12.7 8 11.5 4.7 9 2c0 4-5 6.6-5 13 0 4.3 3.4 7 8 7Z" />
  </Icon>
);
export const PlayIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7 4.5v15a1 1 0 0 0 1.5.9l12-7.5a1 1 0 0 0 0-1.8l-12-7.5A1 1 0 0 0 7 4.5Z" />
  </Icon>
);
export const PauseIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="6" y="4" width="4" height="16" rx="1.5" />
    <rect x="14" y="4" width="4" height="16" rx="1.5" />
  </Icon>
);
export const StepIcon = (p: IconProps & { back?: boolean }) => {
  const { back, ...rest } = p;
  return (
    <Icon {...rest}>
      {back ? <path d="M18 5 9 12l9 7V5ZM6 5v14" /> : <path d="m6 5 9 7-9 7V5ZM18 5v14" />}
    </Icon>
  );
};
export const StarIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9L12 3Z" />
  </Icon>
);
export const VerifiedIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 2.5 14.4 4l2.8-.2 1 2.6 2.3 1.6-.7 2.7.7 2.7-2.3 1.6-1 2.6-2.8-.2L12 21.5 9.6 20l-2.8.2-1-2.6-2.3-1.6.7-2.7-.7-2.7 2.3-1.6 1-2.6 2.8.2L12 2.5Z" fill="currentColor" stroke="none" />
    <path d="m8.5 12 2.4 2.4 4.6-4.8" stroke="white" strokeWidth={2.4} />
  </Icon>
);
/** A medal on a ribbon, for titles. */
export const MedalIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 2.5h2.6l1.4 5 1.4-5H16l-2.3 7" />
    <path d="M10.3 9.5 8 2.5" />
    <circle cx="12" cy="15" r="6" />
    <path d="m12 12.3.9 1.8 2 .3-1.5 1.4.4 2L12 16.9l-1.8.9.4-2-1.5-1.4 2-.3.9-1.8Z" />
  </Icon>
);
export const ClockIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Icon>
);
export const GridIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="3" width="18" height="18" rx="3" />
    <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
  </Icon>
);
/** A gold coin (filled, not a line icon), for coin balances and rewards. */
export const CoinIcon = ({ size = 20, ...rest }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...rest}>
    <circle cx="12" cy="12" r="10" className="fill-amber-300 stroke-amber-500" strokeWidth="1.8" />
    <circle cx="12" cy="12" r="6.4" fill="none" className="stroke-amber-100" strokeWidth="1.6" />
    <path d="M12 8.6v6.8" className="stroke-amber-600" strokeWidth="2" strokeLinecap="round" />
  </svg>
);
/** An avatar inside a frame. */
/** Name effects (hiệu ứng tên): a magic wand with a star at its tip. */
export const NameStyleIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 20 13 11" />
    <path d="M16 3.8l1.3 3.4 3.4 1.3-3.4 1.3L16 13.2l-1.3-3.4-3.4-1.3 3.4-1.3Z" />
    <path d="M6 4v3M4.5 5.5h3" />
    <path d="M20 16v3M18.5 17.5h3" />
  </Icon>
);
export const FrameIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9.5" />
    <circle cx="12" cy="10" r="2.6" />
    <path d="M7.3 17.4a5.5 5.5 0 0 1 9.4 0" />
  </Icon>
);
