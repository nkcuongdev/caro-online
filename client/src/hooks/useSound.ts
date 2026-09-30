import { useSyncExternalStore } from 'react';
import { isSoundOn, onSoundChange, setSoundOn } from '../lib/sound';

export function useSound() {
  const on = useSyncExternalStore(onSoundChange, isSoundOn, isSoundOn);
  return [on, setSoundOn] as const;
}
