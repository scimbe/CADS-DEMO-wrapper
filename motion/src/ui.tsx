import React, {createContext, useContext} from 'react';
import {AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {C, F, dur, ease, springs} from './theme';

export type Lang = 'de' | 'en';
export const LangCtx = createContext<Lang>('de');
export const useT = () => {
  const l = useContext(LangCtx);
  return (de: string, en: string) => (l === 'de' ? de : en);
};
export const useLayout = () => {
  const {width, height} = useVideoConfig();
  return {width, height, V: height > width};
};

export const prog = (frame: number, start: number, d: number = dur.normal) =>
  interpolate(frame, [start, start + d], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease});

/** Blendet Kind ein (Fade + leichter Versatz). */
export const Appear: React.FC<{at: number; dy?: number; dx?: number; d?: number; style?: React.CSSProperties; children: React.ReactNode}> = ({at, dy = 24, dx = 0, d = dur.normal, style, children}) => {
  const f = useCurrentFrame();
  const p = prog(f, at, d);
  return <div style={{opacity: p, transform: `translate(${dx * (1 - p)}px, ${dy * (1 - p)}px)`, ...style}}>{children}</div>;
};

/** Feder-Pop. */
export const Pop: React.FC<{at: number; style?: React.CSSProperties; bouncy?: boolean; children: React.ReactNode}> = ({at, style, bouncy, children}) => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const s = spring({frame: f - at, fps, config: bouncy ? springs.bouncy : springs.gentle});
  return <div style={{opacity: Math.min(1, s * 2), transform: `scale(${0.6 + 0.4 * s})`, ...style}}>{children}</div>;
};

/** Szene: Fade-in/out an den Rändern der Sequenz. */
export const SceneFade: React.FC<{len: number; children: React.ReactNode}> = ({len, children}) => {
  const f = useCurrentFrame();
  const o = Math.min(prog(f, 0, 10), 1 - prog(f, len - 10, 10));
  return <AbsoluteFill style={{opacity: o}}>{children}</AbsoluteFill>;
};

const grid = `linear-gradient(${C.line}22 1px, transparent 1px), linear-gradient(90deg, ${C.line}22 1px, transparent 1px)`;
export const Stage: React.FC<{children: React.ReactNode}> = ({children}) => {
  const {V} = useLayout();
  return (
    <AbsoluteFill style={{background: `radial-gradient(1200px 800px at 50% 0%, #16264a 0%, ${C.bg} 70%)`, fontFamily: F.sans, color: C.text}}>
      <AbsoluteFill style={{backgroundImage: grid, backgroundSize: '64px 64px', opacity: 0.6}} />
      {children}
      <div style={{position: 'absolute', bottom: V ? 56 : 34, left: 0, right: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, color: C.mute, fontSize: 28, letterSpacing: 1}}>
        <Diamond size={22} /> bunsenbrenner.org
      </div>
    </AbsoluteFill>
  );
};

export const Diamond: React.FC<{size?: number}> = ({size = 24}) => (
  <div style={{width: size, height: size, background: C.flame, transform: 'rotate(45deg)', borderRadius: size * 0.12}} />
);

export const Center: React.FC<{children: React.ReactNode; gap?: number; style?: React.CSSProperties}> = ({children, gap = 40, style}) => {
  const {V} = useLayout();
  return (
    <AbsoluteFill style={{display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap, padding: V ? '80px 60px 120px' : '60px 100px 100px', textAlign: 'center', ...style}}>
      {children}
    </AbsoluteFill>
  );
};

export const Big: React.FC<{children: React.ReactNode; size?: number; color?: string; style?: React.CSSProperties}> = ({children, size = 92, color = C.text, style}) => {
  const {V} = useLayout();
  return <div style={{fontSize: V ? size * 0.86 : size, fontWeight: 800, lineHeight: 1.08, letterSpacing: -1.5, color, ...style}}>{children}</div>;
};
export const Sub: React.FC<{children: React.ReactNode; size?: number; color?: string; style?: React.CSSProperties}> = ({children, size = 44, color = C.mute, style}) => (
  <div style={{fontSize: size, fontWeight: 500, lineHeight: 1.25, color, ...style}}>{children}</div>
);

export const Chip: React.FC<{children: React.ReactNode; color?: string; mono?: boolean; size?: number; style?: React.CSSProperties}> = ({children, color = C.blue, mono, size = 30, style}) => (
  <span style={{display: 'inline-flex', alignItems: 'center', gap: 10, padding: '8px 20px', borderRadius: 999, border: `2px solid ${color}`, color, background: `${color}18`, fontSize: size, fontWeight: 700, fontFamily: mono ? F.mono : F.sans, whiteSpace: 'nowrap', ...style}}>{children}</span>
);

export const Card: React.FC<{children: React.ReactNode; border?: string; style?: React.CSSProperties}> = ({children, border = C.line, style}) => (
  <div style={{background: C.panel, border: `2px solid ${border}`, borderRadius: 28, padding: 32, boxShadow: '0 20px 60px #0008', ...style}}>{children}</div>
);

// ---------- Icons (Strich-Icons, 64er Raster) ----------
type IconProps = {size?: number; color?: string; sw?: number};
const Svg: React.FC<IconProps & {children: React.ReactNode}> = ({size = 96, color = C.text, sw = 4, children}) => (
  <svg width={size} height={size} viewBox="0 0 64 64" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">{children}</svg>
);
export const IShield: React.FC<IconProps> = (p) => (<Svg {...p}><path d="M32 6 54 14v16c0 14-9 24-22 28C19 54 10 44 10 30V14z" /><path d="m22 32 7 7 14-15" /></Svg>);
export const IBox: React.FC<IconProps> = (p) => (<Svg {...p}><path d="M32 6 56 18v28L32 58 8 46V18z" /><path d="M8 18l24 12 24-12M32 30v28" /></Svg>);
export const IKey: React.FC<IconProps> = (p) => (<Svg {...p}><circle cx="22" cy="32" r="12" /><path d="M34 32h24M50 32v10M42 32v7" /></Svg>);
export const ILock: React.FC<IconProps> = (p) => (<Svg {...p}><rect x="12" y="28" width="40" height="28" rx="6" /><path d="M20 28v-8a12 12 0 0 1 24 0v8" /></Svg>);
export const ILaptop: React.FC<IconProps> = (p) => (<Svg {...p}><rect x="12" y="14" width="40" height="28" rx="4" /><path d="M4 50h56" /></Svg>);
export const IServer: React.FC<IconProps> = (p) => (<Svg {...p}><rect x="8" y="10" width="48" height="18" rx="4" /><rect x="8" y="36" width="48" height="18" rx="4" /><path d="M18 19h.1M18 45h.1" /></Svg>);
export const IPhone: React.FC<IconProps> = (p) => (<Svg {...p}><rect x="18" y="4" width="28" height="56" rx="7" /><path d="M29 52h6" /></Svg>);
export const ICloud: React.FC<IconProps> = (p) => (<Svg {...p}><path d="M20 46a12 12 0 0 1-1-24 14 14 0 0 1 27 3 10 10 0 0 1-2 21z" /></Svg>);
export const ICheck: React.FC<IconProps> = (p) => (<Svg {...p}><path d="m14 34 12 12 24-26" /></Svg>);
export const ICross: React.FC<IconProps> = (p) => (<Svg {...p}><path d="M16 16 48 48M48 16 16 48" /></Svg>);
export const IWarn: React.FC<IconProps> = (p) => (<Svg {...p}><path d="M32 8 58 54H6z" /><path d="M32 26v14M32 47h.1" /></Svg>);
export const IGpu: React.FC<IconProps> = (p) => (<Svg {...p}><rect x="6" y="16" width="52" height="30" rx="4" /><circle cx="24" cy="31" r="8" /><circle cx="44" cy="31" r="5" /><path d="M12 52h40" /></Svg>);
export const IAnchor: React.FC<IconProps> = (p) => (<Svg {...p}><circle cx="32" cy="12" r="5" /><path d="M32 17v40M20 30h24M10 40c2 12 12 17 22 17s20-5 22-17" /></Svg>);

// ---------- Bildrahmen mit echten Screenshots ----------
/** Browser-Fenster; zeigt Ausschnitt eines Screenshots. cx/cy = Bildmitte als Anteil (0..1), zoom = Breite relativ zum Fenster. */
export const Browser: React.FC<{src: string; aspect: number; w: number; h: number; url?: string; zoom?: number; cx?: number; cy?: number; children?: React.ReactNode; style?: React.CSSProperties}> = ({src, aspect, w, h, url = 'demos…bunsenbrenner.org', zoom = 1, cx = 0.5, cy = 0, children, style}) => {
  const bar = 48;
  const vh = h - bar;
  const iw = w * zoom;
  const ih = iw / aspect;
  const left = w / 2 - cx * iw;
  const top = Math.min(0, Math.max(vh - ih, vh / 2 - cy * ih));
  return (
    <div style={{width: w, height: h, borderRadius: 22, overflow: 'hidden', background: '#fff', border: `2px solid ${C.line}`, boxShadow: '0 30px 80px #000a', position: 'relative', ...style}}>
      <div style={{height: bar, background: '#1d2a47', display: 'flex', alignItems: 'center', gap: 10, padding: '0 18px'}}>
        {['#ff5f57', '#febc2e', '#28c840'].map((c) => (<div key={c} style={{width: 14, height: 14, borderRadius: 7, background: c}} />))}
        <div style={{marginLeft: 16, flex: 1, background: '#0e172b', color: C.mute, fontFamily: F.mono, fontSize: 20, padding: '5px 16px', borderRadius: 10, overflow: 'hidden', whiteSpace: 'nowrap'}}>{url}</div>
      </div>
      <div style={{position: 'absolute', top: bar, left: 0, right: 0, bottom: 0, overflow: 'hidden'}}>
        <div style={{position: 'absolute', left, top, width: iw, height: ih}}>
          <Img src={staticFile(src)} style={{width: '100%', height: '100%', display: 'block'}} />
          {children}
        </div>
      </div>
    </div>
  );
};

/** Overlay-Markierung in Bildanteilen (0..1). */
export const Ring: React.FC<{x: number; y: number; w: number; h: number; at: number; color?: string}> = ({x, y, w, h, at, color = C.ok}) => {
  const f = useCurrentFrame();
  const p = prog(f, at, 14);
  const pulse = 1 + 0.015 * Math.sin((f - at) / 6);
  return <div style={{position: 'absolute', left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%`, border: `5px solid ${color}`, borderRadius: 14, boxShadow: `0 0 0 6px ${color}33, 0 0 40px ${color}66`, opacity: p, transform: `scale(${(1.08 - 0.08 * p) * pulse})`}} />;
};

/** Android-artiges Telefon, zeigt einen (langen) Screenshot mit optionalem Scroll 0..1. */
export const Phone: React.FC<{src: string; aspect: number; w: number; scroll?: number; children?: React.ReactNode; style?: React.CSSProperties}> = ({src, aspect, w, scroll = 0, children, style}) => {
  const pad = 14;
  const sw = w - pad * 2;
  const sh = Math.round(sw * 2.05);
  const ih = sw / aspect;
  const ty = -scroll * Math.max(0, ih - sh);
  return (
    <div style={{width: w, background: '#05080f', border: `3px solid ${C.line}`, borderRadius: 52, padding: pad, boxShadow: '0 40px 90px #000b', position: 'relative', ...style}}>
      <div style={{width: sw, height: sh, borderRadius: 38, overflow: 'hidden', background: '#fff', position: 'relative'}}>
        <Img src={staticFile(src)} style={{width: sw, height: ih, display: 'block', transform: `translateY(${ty}px)`}} />
        {children}
      </div>
      <div style={{position: 'absolute', top: pad + 14, left: '50%', width: 16, height: 16, marginLeft: -8, borderRadius: 8, background: '#05080f'}} />
    </div>
  );
};

export const Typed: React.FC<{text: string; at: number; cps?: number}> = ({text, at, cps = 22}) => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const n = Math.max(0, Math.min(text.length, Math.floor(((f - at) / fps) * cps)));
  return <>{text.slice(0, n)}</>;
};
