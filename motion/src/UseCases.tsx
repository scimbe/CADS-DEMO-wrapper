import React from 'react';
import {AbsoluteFill, Audio, Img, Sequence, interpolate, staticFile, useCurrentFrame} from 'remotion';
import {C, F, sec} from './theme';
import {Appear, Big, Center, Chip, Diamond, IAnchor, ICheck, ICloud, IGpu, ILaptop, ILock, IPhone, Pop, SceneFade, Stage, Sub, prog, useLayout, useT, LangCtx} from './ui';
import timing from './vo-timing.json';
import rectsJson from '../public/real/uc/rects.json';
import specJson from './usecases.json';
import {BOX, MIN_SCALE, R, SIZES, Size, cropFor} from './crop';

// Anwendungsfall-Videos: "So einfach geht's" und zwei kurze Clips. Alle Bilder sind echte
// Bildschirmaufnahmen der laufenden Demos (scripts/capture-usecases.mjs); die Szenenlaengen
// kommen aus der gemessenen Sprechdauer (scripts/voice.py -> vo-timing.json).

export type Slug = string;
type Lang = 'de' | 'en';
type SceneT = {from: number; len: number; dur: number};
const T = timing as unknown as Record<Slug, Record<Lang, {scenes: SceneT[]; total: number}>>;
export const ucLength = (slug: Slug, lang: Lang) => T[slug][lang].total;
const LEAD = sec(0.35);
const SOLID: React.CSSProperties = {background: '#0e1a31', boxShadow: '0 10px 30px #000a'};

const rects = rectsJson as unknown as Record<string, Record<string, R>>;
const rect = (shot: string, key: string): R => {
  const r = rects[shot]?.[key];
  if (!r) throw new Error(`rect ${shot}/${key} missing`);
  return r;
};

// ---------- Bausteine ----------

type Crop = ReturnType<typeof cropFor>;

/** Ausschnitt einer Aufnahme im Browserrahmen, in fester Vergroesserung (siehe crop.ts). */
const Shot: React.FC<{src: string; crop?: Crop; url?: string; whole?: boolean; children?: React.ReactNode}> = ({src, crop, url, whole, children}) => {
  const f = useCurrentFrame();
  const {V} = useLayout();
  const box = BOX[V ? 'V' : 'H'];
  const push = interpolate(f, [0, 150], [1, 1.035], {extrapolateRight: 'clamp'});
  const inner = crop && !whole ? (
    <div style={{position: 'absolute', left: `${(-crop.x / crop.w) * 100}%`, top: `${(-crop.y / crop.h) * 100}%`, width: `${100 / crop.w}%`, height: `${100 / crop.h}%`}}>
      <Img src={staticFile(src)} style={{width: '100%', height: '100%', display: 'block'}} />
      {children}
    </div>
  ) : <Img src={staticFile(src)} style={{width: '100%', height: '100%', objectFit: 'contain', display: 'block', background: '#fff'}} />;
  return (
    <div style={{width: box.w, borderRadius: 22, overflow: 'hidden', border: `2px solid ${C.line}`, boxShadow: '0 30px 80px #000a', background: '#fff'}}>
      <div style={{height: 48, background: '#1d2a47', display: 'flex', alignItems: 'center', gap: 10, padding: '0 18px'}}>
        {['#ff5f57', '#febc2e', '#28c840'].map((c) => (<div key={c} style={{width: 14, height: 14, borderRadius: 7, background: c}} />))}
        <div style={{marginLeft: 16, flex: 1, background: '#0e172b', color: C.mute, fontFamily: F.mono, fontSize: 22, padding: '5px 16px', borderRadius: 10, whiteSpace: 'nowrap', overflow: 'hidden'}}>{url}</div>
      </div>
      <div style={{width: box.w, height: box.h, overflow: 'hidden', position: 'relative', background: '#fff'}}>
        <div style={{position: 'absolute', inset: 0, transform: `scale(${push})`, transformOrigin: '50% 50%'}}>{inner}</div>
      </div>
    </div>
  );
};

/** Markierung in Bildanteilen. */
const Mark: React.FC<{r: R; at: number; color?: string; pad?: number}> = ({r, at, color = C.flame, pad = 0.006}) => {
  const f = useCurrentFrame();
  const p = prog(f, at, 12);
  return <div style={{position: 'absolute', left: `${(r.x - pad) * 100}%`, top: `${(r.y - pad) * 100}%`, width: `${(r.w + 2 * pad) * 100}%`, height: `${(r.h + 2 * pad) * 100}%`, border: `3px solid ${color}`, borderRadius: 8, boxShadow: `0 0 0 4px ${color}33, 0 0 20px ${color}88`, opacity: p, transform: `scale(${1.04 - 0.04 * p})`}} />;
};

/** Zahl im Kreis + Schrittname. */
const StepHead: React.FC<{n?: number; title: string; sub?: string}> = ({n, title, sub}) => {
  const {V} = useLayout();
  return (
    <div style={{display: 'flex', flexDirection: V ? 'row' : 'column', alignItems: V ? 'center' : 'flex-start', gap: V ? 30 : 26, textAlign: 'left'}}>
      {n !== undefined && (
        <Pop at={0} bouncy>
          <div style={{width: V ? 130 : 150, height: V ? 130 : 150, borderRadius: 999, background: C.flame, color: '#1a0d02', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: V ? 86 : 100, fontWeight: 900}}>{n}</div>
        </Pop>
      )}
      <div>
        <Appear at={6}><div style={{fontSize: V ? 76 : 76, fontWeight: 800, overflowWrap: 'anywhere', lineHeight: 1.05, letterSpacing: -1.5}}>{title}</div></Appear>
        {sub && <Appear at={16}><Sub size={V ? 40 : 40} style={{marginTop: 14}}>{sub}</Sub></Appear>}
      </div>
    </div>
  );
};

/** Schritt-Layout: links/oben die Ansage, rechts/unten das echte Bild. */
const StepLayout: React.FC<{head: React.ReactNode; children: React.ReactNode}> = ({head, children}) => {
  const {V} = useLayout();
  if (V) {
    return (
      <AbsoluteFill style={{display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 56, padding: '60px 60px 170px'}}>
        <div style={{width: 960}}>{head}</div>
        <Appear at={4} dy={40}>{children}</Appear>
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill style={{display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 70, padding: '40px 60px 100px'}}>
      <div style={{width: 640, flexShrink: 0}}>{head}</div>
      <Appear at={4} dx={60} dy={0}>{children}</Appear>
    </AbsoluteFill>
  );
};

type ShotSpec = {name?: string; src?: string; size?: Size; cut?: 'desk' | 'mob'; focus?: string; r?: R; clip?: {x: number; w: number}; scale?: number; scaleV?: number; whole?: boolean; at?: number; marks?: {key: string; at: number; color?: string; r?: R}[]};

/** Echte Aufnahme passend zum Format; Kreuzblende zwischen mehreren Aufnahmen. */
const Real: React.FC<{shots: ShotSpec[]; url: string; en?: boolean}> = ({shots, url, en}) => {
  const {V} = useLayout();
  const f = useCurrentFrame();
  return (
    <div style={{position: 'relative'}}>
      {shots.map((s, i) => {
        const k = s.cut ?? 'mob';
        const base = s.name ? (rects[`${s.name}-${k}${en ? '-en' : ''}`] ? `${s.name}-${k}${en ? '-en' : ''}` : `${s.name}-${k}`) : '';
        const size = s.size ?? SIZES[k];
        const fr0 = s.r ?? (s.focus ? rect(base, s.focus) : {x: 0.25, y: 0.25, w: 0.5, h: 0.5});
        const fr = s.clip ? {...fr0, ...s.clip} : fr0;
        const fmt = V ? 'V' : 'H';
        const crop = cropFor(fr, size, BOX[fmt], (V ? s.scaleV : undefined) ?? s.scale ?? MIN_SCALE[fmt]);
        const next = shots[i + 1];
        const vis = (i === 0 ? 1 : prog(f, s.at ?? 0, 12)) * (next ? 1 - prog(f, next.at ?? 0, 12) : 1);
        return (
          <div key={`${s.name ?? s.src}${i}`} style={{position: i === 0 ? 'relative' : 'absolute', inset: 0, opacity: vis}}>
            <Shot src={s.src ?? `real/uc/${base}.jpg`} crop={crop} url={url} whole={s.whole}>
              {(s.marks ?? []).map((m) => (<Mark key={m.key} r={m.r ?? rect(base, m.key)} at={m.at} color={m.color} />))}
            </Shot>
          </div>
        );
      })}
    </div>
  );
};

const Closing: React.FC<{lines: React.ReactNode; cta: React.ReactNode}> = ({lines, cta}) => (
  <Center gap={44}>
    <Appear at={0}><Diamond size={54} /></Appear>
    <Appear at={6}>{lines}</Appear>
    <Appear at={30}>{cta}</Appear>
  </Center>
);

const CtaButton: React.FC<{children: React.ReactNode}> = ({children}) => {
  const f = useCurrentFrame();
  const pulse = 1 + 0.03 * Math.sin(f / 7);
  return <div style={{display: 'inline-block', background: C.flame, color: '#1a0d02', fontSize: 52, fontWeight: 800, padding: '22px 46px', borderRadius: 18, transform: `scale(${pulse})`, boxShadow: `0 0 50px ${C.flame}66`}}>{children}</div>;
};

/** Spielt die Szenen nach der Zeitachse ab, je Szene mit ihrer Sprachzeile. */
const Track: React.FC<{slug: Slug; scenes: React.ReactNode[]}> = ({slug, scenes}) => {
  const lang = React.useContext(LangCtx) as Lang;
  const t = T[slug][lang].scenes;
  return (
    <Stage>
      {scenes.map((el, i) => (
        <Sequence key={i} from={t[i].from} durationInFrames={t[i].len} premountFor={15}>
          <SceneFade len={t[i].len}>{el}</SceneFade>
          <Sequence from={LEAD}><Audio src={staticFile(`vo/${slug}.${lang}.${i}.m4a`)} /></Sequence>
        </Sequence>
      ))}
    </Stage>
  );
};

// ---------- 1. So einfach geht's ----------

const SoEinfach: React.FC = () => {
  const t = useT();
  const lang = React.useContext(LangCtx) as Lang;
  const en = lang === 'en';
  const {V} = useLayout();
  const url = 'demos-34a13a96.bunsenbrenner.org';
  const dLen = (i: number) => T['so-einfach'][lang].scenes[i].len;
  const BRIEF = {x: 0.08, y: 0.066, w: 0.84, h: 0.26};
  const scenes = [
    // 1 Problem
    <Center gap={34} key="p">
      <Pop at={2} bouncy><IAnchor size={170} color={C.blue} /></Pop>
      <Appear at={8}><Big size={120}>{t('Samstag segeln.', 'Sailing on Saturday.')}</Big></Appear>
      <Appear at={40}><Big size={120} color={C.flame}>{t('Hält das Wetter?', 'Will the weather hold?')}</Big></Appear>
    </Center>,
    // 2 Schritt 1
    <StepLayout key="s1" head={<StepHead n={1} title={t('Vorlage wählen', 'Pick a template')} sub={t('im Marktplatz', 'in the marketplace')} />}>
      <Real url={url} en={en} shots={[{name: 'gallery-cards', focus: 'cardbox', marks: [{key: 'cardbox', at: 30}]}]} />
    </StepLayout>,
    // 3 Schritt 2
    <StepLayout key="s2" head={<StepHead n={2} title={t('Angaben eintragen', 'Enter your details')} sub={t('Ort + ein Satz in deinen Worten', 'Place + one sentence in your words')} />}>
      <Real url={url} en={en} shots={[
        {name: 'nl-form-top', focus: 'ort', marks: [{key: 'ort', at: 20}]},
        {name: 'nl-form-hint', focus: 'hint', at: Math.round(dLen(2) * 0.45), marks: [{key: 'hint', at: Math.round(dLen(2) * 0.45) + 10}]},
      ]} />
    </StepLayout>,
    // 4 Schritt 3 (echtes Briefing aus echtem Lauf, Bremen)
    <StepLayout key="s3" head={<StepHead n={3} title={t('Ergebnis bekommen', 'Get the result')} sub={t('fertiges Briefing, echte Wetterdaten', 'finished briefing, real weather data')} />}>
      <div style={{position: 'relative'}}>
        <Real url={`${url}/d/newsletter/out/report.html`} shots={[{src: 'real/report-mobile-brief.jpg', size: SIZES.mob, r: BRIEF, marks: [{key: 'b', r: BRIEF, at: Math.round(dLen(3) * 0.5), color: C.ok}]}]} />
        <div style={{position: 'absolute', left: 0, right: 0, ...(V ? {bottom: -64} : {bottom: -70}), display: 'flex', justifyContent: 'center'}}>
          <Appear at={Math.round(dLen(3) * 0.5)}><Chip color={C.ok} size={34} style={SOLID}>{V ? t('Echter Lauf · Bremen', 'Real run · Bremen') : t('Echter Lauf · Bremen · „Segelgruppe, Wind und Regen hervorheben“', 'Real run · Bremen · German output')}</Chip></Appear>
        </div>
      </div>
    </StepLayout>,
    // 5 Ohne Technik, mit Vertrauen
    <Center gap={40} key="tr">
      <div style={{display: 'flex', gap: 24, flexWrap: 'wrap', justifyContent: 'center'}}>
        <Pop at={2}><Chip color={C.ok} size={V ? 46 : 52}><ICheck size={44} color={C.ok} sw={7} />{t('Kein Programmieren', 'No coding')}</Chip></Pop>
        <Pop at={14}><Chip color={C.ok} size={V ? 46 : 52}><ICheck size={44} color={C.ok} sw={7} />{t('Kein Prompt', 'No prompts')}</Chip></Pop>
      </div>
      <Appear at={Math.round(dLen(4) * 0.4)}>
        <div style={{transform: `scale(${V ? 0.9 : 0.72})`, marginBottom: V ? -100 : -220, marginTop: V ? -50 : -110}}><Real url={url} en={en} shots={[{name: 'nl-check', focus: 'ok', marks: [{key: 'ok', at: Math.round(dLen(4) * 0.4) + 12, color: C.ok}]}]} /></div>
      </Appear>
    </Center>,
    // 6 Was als Naechstes
    <Closing key="n" lines={
      <div style={{display: 'flex', flexDirection: 'column', gap: 26, alignItems: 'center'}}>
        <Big size={V ? 84 : 96}>{t('Immer dieselben 3 Schritte', 'Always the same 3 steps')}</Big>
        <div style={{display: 'flex', flexDirection: V ? 'column' : 'row', gap: V ? 18 : 30, alignItems: 'center'}}>
          {[t('Vorlage wählen', 'Pick a template'), t('Angaben eintragen', 'Enter details'), t('Ergebnis bekommen', 'Get the result')].map((s, i) => (
            <Appear key={s} at={10 + i * 10}><div style={{display: 'flex', alignItems: 'center', gap: 16, fontSize: 46, fontWeight: 700}}>
              <span style={{width: 70, height: 70, borderRadius: 99, background: C.flame, color: '#1a0d02', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900}}>{i + 1}</span>{s}
            </div></Appear>
          ))}
        </div>
        <Appear at={44}><Sub size={42}>{t('Wetter · Verträge · Diagramme · Fotos · Videos', 'Weather · contracts · charts · photos · videos')}</Sub></Appear>
      </div>
    } cta={<div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 22}}>
      <CtaButton>{t('Ausprobieren →', 'Try it →')}</CtaButton>
      <Sub size={32}>{t('Vorlage unten aussuchen · Ansehen frei, Ausführen mit Konto', 'Pick a template below · viewing is free, running needs an account')}</Sub>
    </div>} />,
  ];
  return <Track slug="so-einfach" scenes={scenes} />;
};

// ---------- 2. Termin per Anruf ----------

const Termin: React.FC = () => {
  const t = useT();
  const lang = React.useContext(LangCtx) as Lang;
  const {V} = useLayout();
  const url = 'assistent-cal-f29c55da.bunsenbrenner.org';
  const len = (i: number) => T['termin-per-anruf'][lang].scenes[i].len;
  const bubble = {x: 0.17, y: 0.688, w: 0.586, h: 0.168};
  const scenes = [
    <StepLayout key="p" head={<StepHead title={t('Friseurtermin?', 'Need a haircut?')} sub={t('Einfach anrufen.', 'Just call.')} />}>
      <Real url={url} shots={[{name: 'cal-start', focus: 'call', marks: [{key: 'call', at: 30}]}]} />
    </StepLayout>,
    <StepLayout key="b" head={<StepHead title={t('Sagen, was du willst', 'Say what you want')} sub={t('Thomas bestätigt den Termin.', 'Thomas confirms the appointment.')} />}>
      <div style={{position: 'relative'}}>
        <Real url={url} shots={[{name: 'cal-booked', r: bubble, marks: [{key: 'b', at: Math.round(len(1) * 0.45), r: bubble, color: C.ok}]}]} />
        <div style={{position: 'absolute', left: 0, right: 0, ...(V ? {bottom: -64} : {bottom: -70}), display: 'flex', justifyContent: 'center'}}>
          <Appear at={20}><Chip color={C.blue} size={32} style={SOLID}>{V ? t('Echter Lauf · getippt', 'Real run · typed') : t('Echter Lauf · hier getippt statt gesprochen', 'Real run · typed here instead of spoken')}</Chip></Appear>
        </div>
      </div>
    </StepLayout>,
    <StepLayout key="c" head={<StepHead title={t('Absagen?', 'Cancel?')} sub={t('Ein Satz genügt.', 'One sentence is enough.')} />}>
      <div style={{position: 'relative'}}>
        <Real url={url} shots={[{name: 'cal-cancel', r: bubble, marks: [{key: 'c', at: 14, r: bubble, color: C.ok}]}]} />
        <div style={{position: 'absolute', left: 0, right: 0, ...(V ? {bottom: -64} : {bottom: -70}), display: 'flex', justifyContent: 'center'}}>
          <Appear at={20}><Chip color={C.ok} size={32} style={SOLID}>{V ? t('Echter Lauf · getippt', 'Real run · typed') : t('Echter Lauf · getippt · Termin wieder frei', 'Real run · typed · slot free again')}</Chip></Appear>
        </div>
      </div>
    </StepLayout>,
    <Closing key="n" lines={
      <div style={{display: 'flex', flexDirection: 'column', gap: 24, alignItems: 'center'}}>
        <Pop at={0} bouncy><IPhone size={150} color={C.flame} /></Pop>
        <Big size={V ? 84 : 96}>{t('Salon Schnittwerk', 'Salon Schnittwerk')}</Big>
        <Sub size={44}>{t('Termin per Anruf – oder per Text', 'Appointments by call – or by text')}</Sub>
      </div>
    } cta={<div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 22}}>
      <CtaButton>{t('📞 Anruf starten', '📞 Start the call')}</CtaButton>
      <Sub size={30} style={{fontFamily: F.mono}}>{url}</Sub>
    </div>} />,
  ];
  return <Track slug="termin-per-anruf" scenes={scenes} />;
};

// ---------- 3. Frag deine Region ----------

const Region: React.FC = () => {
  const t = useT();
  const lang = React.useContext(LangCtx) as Lang;
  const {V} = useLayout();
  const url = 'callcenter-34a13a96.bunsenbrenner.org';
  const len = (i: number) => T['frag-deine-region'][lang].scenes[i].len;
  const scenes = [
    <Center gap={34} key="p">
      <Appear at={4}><Big size={V ? 108 : 116}>{t('Wie gut ist meine Region versorgt?', 'How well is my region served?')}</Big></Appear>
      <Appear at={30}><Sub size={46}>{t('Ärzte · Arbeit · Bevölkerung', 'Doctors · jobs · population')}</Sub></Appear>
    </Center>,
    <StepLayout key="a" head={<StepHead title={t('Anrufen oder tippen', 'Call or type')} />}>
      <Real url={url} shots={[{name: 'cc-start', focus: 'call', marks: [{key: 'call', at: 16}]}]} />
    </StepLayout>,
    <StepLayout key="r" head={<StepHead title={t('Antwort mit echten Zahlen', 'An answer with real figures')} sub={t('Quelle: Deutschlandatlas', 'Source: Deutschlandatlas')} />}>
      <div style={{position: 'relative'}}>
        <Real url={url} shots={[{name: 'cc-answer', focus: 'answer', marks: [{key: 'answer', at: Math.round(len(2) * 0.35)}, {key: 'src', at: Math.round(len(2) * 0.6), color: C.ok}]}]} />
        <div style={{position: 'absolute', left: 0, right: 0, ...(V ? {bottom: -64} : {bottom: -74}), display: 'flex', justifyContent: 'center'}}>
          <Appear at={Math.round(len(2) * 0.35)}><Chip color={C.flame} size={V ? 34 : 38} style={SOLID}>{V ? t('Hannover: 65 je 100.000', 'Hannover: 65 per 100,000') : t('Hannover: 65 Hausärzte je 100.000 Einwohner', 'Hannover: 65 family doctors per 100,000 residents')}</Chip></Appear>
        </div>
      </div>
    </StepLayout>,
    <Closing key="n" lines={
      <div style={{display: 'flex', flexDirection: 'column', gap: 24, alignItems: 'center'}}>
        <Big size={V ? 84 : 96}>{t('Frag nach deiner Region', 'Ask about your region')}</Big>
        <Sub size={44}>{t('In der Galerie:', 'In the gallery:')}</Sub>
      </div>
    } cta={<CtaButton>{t('Sprachassistent für Regionaldaten ↗', 'Voice assistant for regional data ↗')}</CtaButton>} />,
  ];
  return <Track slug="frag-deine-region" scenes={scenes} />;
};

// ---------- Schaubild "Firmennetz Nordwind" (Grafik, keine Aufnahme: die Seite braucht eine Anmeldung) ----------
// Aufbau wie im Dashboard der Demo: die Zentrale in der Mitte, Cloud, Werkstatt und Hafenbuero je ueber einen eigenen Kanal.

type NetPhase = 'sites' | 'roles' | 'secure';
const NODES: {key: 'cloud' | 'zentrale' | 'werkstatt' | 'hafen'; x: number; y: number; label: LT; role?: LT}[] = [
  {key: 'cloud', x: 0.4, y: 0.11, label: {de: 'Cloud', en: 'Cloud'}},
  {key: 'zentrale', x: 0.4, y: 0.37, label: {de: 'Zentrale', en: 'HQ'}, role: {de: 'führt zusammen', en: 'combines both'}},
  {key: 'werkstatt', x: 0.78, y: 0.65, label: {de: 'Werkstatt', en: 'Workshop'}, role: {de: 'schreibt den Text', en: 'writes the text'}},
  {key: 'hafen', x: 0.2, y: 0.65, label: {de: 'Hafenbüro', en: 'Harbour office'}, role: {de: 'holt das Wetter', en: 'fetches weather'}},
];
const EDGES: [string, string][] = [['cloud', 'zentrale'], ['zentrale', 'werkstatt'], ['zentrale', 'hafen']];

const trim = (a: {x: number; y: number}, b: {x: number; y: number}, r: number) => {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  const u = {x: (b.x - a.x) / d, y: (b.y - a.y) / d};
  return [{x: a.x + u.x * r, y: a.y + u.y * r}, {x: b.x - u.x * r, y: b.y - u.y * r}];
};

const NetMap: React.FC<{phase: NetPhase; len: number}> = ({phase, len}) => {
  const f = useCurrentFrame();
  const lang = React.useContext(LangCtx) as Lang;
  const {V} = useLayout();
  const box = BOX[V ? 'V' : 'H'];
  const at = (x: number) => Math.round(x * len);
  const pos = (k: string) => { const n = NODES.find((q) => q.key === k)!; return {x: n.x * box.w, y: n.y * box.h}; };
  // wann ein Standort erscheint (Reihenfolge wie gesprochen: Cloud, Zentrale, Werkstatt, Hafenbuero)
  const appearAt: Record<string, number> = phase === 'sites' ? {cloud: at(0.36), zentrale: at(0.5), werkstatt: at(0.64), hafen: at(0.8)} : {cloud: 0, zentrale: 2, werkstatt: 4, hafen: 6};
  const roleAt: Record<string, number> = {hafen: at(0.3), werkstatt: at(0.5), zentrale: at(0.78)};
  const edgeAt = phase === 'sites' ? at(0.88) : 8;
  const secure = phase === 'secure';
  const flows: [string, string, number][] = phase === 'roles' ? [['hafen', 'zentrale', roleAt.hafen + 10], ['werkstatt', 'zentrale', roleAt.werkstatt + 10]] : [];
  const D = V ? 150 : 130;
  return (
    <div style={{position: 'relative', width: box.w, height: box.h, borderRadius: 22, border: `2px solid ${C.line}`, background: '#0e1a31', boxShadow: '0 30px 80px #000a', overflow: 'hidden'}}>
      <svg width={box.w} height={box.h} viewBox={`0 0 ${box.w} ${box.h}`} style={{position: 'absolute', inset: 0}}>
        {EDGES.map(([a, b]) => {
          const [pa, pb] = trim(pos(a), pos(b), D / 2 + 6);
          const p = prog(f, edgeAt, 16);
          return <line key={a + b} x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} stroke={secure ? C.ok : C.blue} strokeWidth={secure ? 7 : 5} strokeLinecap="round" opacity={p} />;
        })}
        {flows.map(([a, b, t0]) => {
          const pa = pos(a), pb = pos(b);
          const k = ((f - t0) % 45) / 45;
          const on = f >= t0 ? 1 : 0;
          return <circle key={a} r={13} fill={C.flame} cx={pa.x + (pb.x - pa.x) * k} cy={pa.y + (pb.y - pa.y) * k} opacity={on} />;
        })}
        {secure && EDGES.map(([a, b]) => {
          const pa = pos(a), pb = pos(b);
          const p = prog(f, at(0.35), 14);
          const k = ((f - at(0.5)) % 60) / 60;
          return <circle key={'d' + a + b} r={11} fill={C.text} cx={pa.x + (pb.x - pa.x) * k} cy={pa.y + (pb.y - pa.y) * k} opacity={f >= at(0.5) ? p : 0} />;
        })}
      </svg>
      {secure && EDGES.map(([a, b]) => {
        const pa = pos(a), pb = pos(b);
        return (
          <div key={'l' + a + b} style={{position: 'absolute', left: (pa.x + pb.x) / 2, top: (pa.y + pb.y) / 2, transform: 'translate(-50%,-50%)'}}>
            <Pop at={at(0.3)} bouncy><div style={{width: 96, height: 96, borderRadius: 99, background: '#0e1a31', border: `4px solid ${C.ok}`, display: 'flex', alignItems: 'center', justifyContent: 'center'}}><ILock size={58} color={C.ok} sw={5} /></div></Pop>
          </div>
        );
      })}
      {NODES.map((n) => {
        const icon = n.key === 'cloud' ? <ICloud size={D * 0.62} color={C.blue} /> : n.key === 'zentrale' ? <ILaptop size={D * 0.62} color={C.flame} /> : n.key === 'werkstatt' ? <IGpu size={D * 0.62} color={C.blue} /> : <IAnchor size={D * 0.62} color={C.blue} />;
        const showRole = phase === 'roles' && n.role;
        const side = n.key === 'cloud' || n.key === 'zentrale';
        return (
          <div key={n.key} style={{position: 'absolute', left: n.x * box.w, top: n.y * box.h, width: 0, height: 0}}>
            <div style={{position: 'absolute', left: -D / 2, top: -D / 2}}>
              <Pop at={appearAt[n.key]} bouncy>
                <div style={{width: D, height: D, borderRadius: 999, background: C.panel2, border: `4px solid ${n.key === 'zentrale' ? C.flame : C.blue}`, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>{icon}</div>
              </Pop>
            </div>
            <div style={side ? {position: 'absolute', left: D / 2 + 22, top: -26, whiteSpace: 'nowrap'} : {position: 'absolute', left: -190, top: D / 2 + 10, width: 380, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8}}>
              <Appear at={appearAt[n.key] + 6} dy={10}><div style={{fontSize: V ? 44 : 40, fontWeight: 800, lineHeight: 1.1}}>{n.label[lang]}</div></Appear>
              {showRole && (
                <Appear at={roleAt[n.key]} dy={10} style={side ? {marginTop: 8} : undefined}>
                  <Chip color={n.key === 'zentrale' ? C.flame : C.ok} size={V ? 34 : 30} style={{background: '#0e1a31'}}>{n.role![lang]}</Chip>
                  {n.key === 'werkstatt' && <div style={{marginTop: 8, display: 'flex', justifyContent: 'center'}}><Chip color={C.blue} size={V ? 30 : 26} style={{background: '#0e1a31'}}>{lang === 'de' ? 'lokale KI' : 'local AI'}</Chip></div>}
                </Appear>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ---------- Weitere Anwendungsfaelle: aus usecases.json ----------

type LT = {de: string; en: string};
type Scene =
  | {kind: 'problem'; big: (LT & {flame?: boolean})[]; sub?: LT}
  | {kind: 'step'; n?: number; title: LT; sub?: LT; shots: (ShotSpec & {at?: number; marks?: {key: string; at: number; color?: string; r?: R}[]})[]; chip?: LT; url?: string}
  | {kind: 'net'; phase: NetPhase; n?: number; title: LT; sub?: LT; chip?: LT}
  | {kind: 'close'; title: LT; sub?: LT; cta: LT; small?: LT};
export type Spec = {id: string; url: string; poster: number; scenes: Scene[]};
export const SPEC = specJson as unknown as Record<string, Spec>;
const COLORS: Record<string, string> = {ok: C.ok, blue: C.blue, flame: C.flame};

export const useCaseVideo = (slug: string): React.FC => () => {
  const lang = React.useContext(LangCtx) as Lang;
  const {V} = useLayout();
  const en = lang === 'en';
  const l = (x: LT) => x[lang];
  const sp = SPEC[slug];
  const scenes = sp.scenes.map((sc, i) => {
    const len = T[slug][lang].scenes[i].len;
    if (sc.kind === 'problem') return (
      <Center gap={34} key={i}>
        {sc.big.map((b, j) => <Appear key={j} at={4 + j * 26}><Big size={V ? 104 : 112} color={b.flame ? C.flame : undefined}>{l(b)}</Big></Appear>)}
        {sc.sub && <Appear at={34}><Sub size={46}>{l(sc.sub)}</Sub></Appear>}
      </Center>
    );
    if (sc.kind === 'close') return (
      <Closing key={i} lines={<div style={{display: 'flex', flexDirection: 'column', gap: 24, alignItems: 'center'}}>
        <Big size={V ? 84 : 96}>{l(sc.title)}</Big>
        {sc.sub && <Sub size={44}>{l(sc.sub)}</Sub>}
      </div>} cta={<div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 22}}>
        <CtaButton>{l(sc.cta)}</CtaButton>
        {sc.small && <Sub size={32}>{l(sc.small)}</Sub>}
      </div>} />
    );
    if (sc.kind === 'net') return (
      <StepLayout key={i} head={<StepHead n={sc.n} title={l(sc.title)} sub={sc.sub && l(sc.sub)} />}>
        <div style={{position: 'relative'}}>
          <NetMap phase={sc.phase} len={len} />
          {sc.chip && <div style={{position: 'absolute', left: 0, right: 0, ...(V ? {bottom: -64} : {bottom: -70}), display: 'flex', justifyContent: 'center'}}>
            <Appear at={16}><Chip color={C.blue} size={V ? 32 : 34} style={SOLID}>{l(sc.chip)}</Chip></Appear>
          </div>}
        </div>
      </StepLayout>
    );
    const shots = sc.shots.map((s) => ({...s, at: s.at === undefined ? undefined : Math.round(s.at * len), marks: (s.marks ?? []).map((m) => ({...m, at: Math.round(m.at * len), color: COLORS[m.color ?? 'flame']}))}));
    return (
      <StepLayout key={i} head={<StepHead n={sc.n} title={l(sc.title)} sub={sc.sub && l(sc.sub)} />}>
        <div style={{position: 'relative'}}>
          <Real url={sc.url ?? sp.url} en={en} shots={shots} />
          {sc.chip && <div style={{position: 'absolute', left: 0, right: 0, ...(V ? {bottom: -64} : {bottom: -70}), display: 'flex', justifyContent: 'center'}}>
            <Appear at={16}><Chip color={C.ok} size={V ? 32 : 34} style={SOLID}>{l(sc.chip)}</Chip></Appear>
          </div>}
        </div>
      </StepLayout>
    );
  });
  return <Track slug={slug} scenes={scenes} />;
};

export const SoEinfachVideo = SoEinfach;
export const TerminVideo = Termin;
export const RegionVideo = Region;
