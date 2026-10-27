import {Easing} from 'remotion';

// Design-Tokens (Claude Motion): alle Dauern/Kurven/Federn kommen von hier.
export const C = {
  bg: '#0b1322',
  panel: '#131f38',
  panel2: '#1b2c4e',
  line: '#2a3d66',
  text: '#f3f6fc',
  mute: '#93a4c8',
  flame: '#ff8a3d',
  ok: '#2fd08a',
  bad: '#ff4d5e',
  warn: '#ffc247',
  blue: '#5aa9ff',
} as const;

export const F = {
  sans: '"Helvetica Neue", Helvetica, Arial, sans-serif',
  mono: 'Menlo, "SF Mono", Consolas, monospace',
} as const;

export const ease = Easing.bezier(0.22, 1, 0.36, 1);

export const dur = {fast: 10, normal: 20, slow: 34} as const; // Frames @30fps
export const springs = {
  snappy: {stiffness: 300, damping: 30},
  gentle: {stiffness: 120, damping: 18},
  bouncy: {stiffness: 260, damping: 12},
} as const;

export const FPS = 30;
export const sec = (s: number) => Math.round(s * FPS);
