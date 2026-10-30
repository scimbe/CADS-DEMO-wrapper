import React from 'react';
import {AbsoluteFill, Audio, Img, Sequence, interpolate, staticFile, useCurrentFrame} from 'remotion';
import {C, F, sec} from './theme';
import {Appear, Big, Center, Chip, Diamond, IAnchor, ICheck, IPhone, Pop, SceneFade, Stage, Sub, prog, useLayout, useT, LangCtx} from './ui';
import timing from './vo-timing.json';
import rectsJson from '../public/real/uc/rects.json';

// Anwendungsfall-Videos: "So einfach geht's" und zwei kurze Clips. Alle Bilder sind echte
// Bildschirmaufnahmen der laufenden Demos (scripts/capture-usecases.mjs); die Szenenlaengen
// kommen aus der gemessenen Sprechdauer (scripts/voice.py -> vo-timing.json).

export type Slug = 'so-einfach' | 'termin-per-anruf' | 'frag-deine-region';
type Lang = 'de' | 'en';
type SceneT = {from: number; len: number; dur: number};
const T = timing as Record<Slug, Record<Lang, {scenes: SceneT[]; total: number}>>;
export const ucLength = (slug: Slug, lang: Lang) => T[slug][lang].total;
const LEAD = sec(0.35);
const SOLID: React.CSSProperties = {background: '#0e1a31', boxShadow: '0 10px 30px #000a'};

type R = {x: number; y: number; w: number; h: number};
const rects = rectsJson as unknown as Record<string, Record<string, R>>;
const rect = (shot: string, key: string): R => {
  const r = rects[shot]?.[key];
  if (!r) throw new Error(`rect ${shot}/${key} missing`);
  return r;
};

// ---------- Bausteine ----------

/** Bildschirmaufnahme im Browser- (Querformat) oder Telefonrahmen; zoomt zum Fokuspunkt. */
const Shot: React.FC<{src: string; aspect: number; w: number; phone?: boolean; url?: string; zoom?: [number, number]; focus?: [number, number]; zoomAt?: [number, number]; children?: React.ReactNode}> = ({src, aspect, w, phone, url, zoom = [1, 1], focus = [0.5, 0.5], zoomAt = [10, 70], children}) => {
  const f = useCurrentFrame();
  const z = interpolate(f, zoomAt, zoom, {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: (t) => 1 - Math.pow(1 - t, 3)});
  const pad = phone ? 14 : 0;
  const sw = w - pad * 2;
  const sh = sw / aspect;
  const screen = (
    <div style={{width: sw, height: sh, overflow: 'hidden', position: 'relative', background: '#fff', borderRadius: phone ? 38 : 0}}>
      <div style={{position: 'absolute', inset: 0, transform: `scale(${z})`, transformOrigin: `${focus[0] * 100}% ${focus[1] * 100}%`}}>
        <Img src={staticFile(src)} style={{width: '100%', height: '100%', display: 'block'}} />
        {children}
      </div>
    </div>
  );
  if (phone) {
    return <div style={{width: w, background: '#05080f', border: `3px solid ${C.line}`, borderRadius: 52, padding: pad, boxShadow: '0 40px 90px #000b'}}>{screen}</div>;
  }
  return (
    <div style={{width: w, borderRadius: 22, overflow: 'hidden', border: `2px solid ${C.line}`, boxShadow: '0 30px 80px #000a', background: '#fff'}}>
      <div style={{height: 48, background: '#1d2a47', display: 'flex', alignItems: 'center', gap: 10, padding: '0 18px'}}>
        {['#ff5f57', '#febc2e', '#28c840'].map((c) => (<div key={c} style={{width: 14, height: 14, borderRadius: 7, background: c}} />))}
        <div style={{marginLeft: 16, flex: 1, background: '#0e172b', color: C.mute, fontFamily: F.mono, fontSize: 20, padding: '5px 16px', borderRadius: 10, whiteSpace: 'nowrap', overflow: 'hidden'}}>{url}</div>
      </div>
      {screen}
    </div>
  );
};

/** Markierung in Bildanteilen. */
const Mark: React.FC<{r: R; at: number; color?: string; pad?: number}> = ({r, at, color = C.flame, pad = 0.006}) => {
  const f = useCurrentFrame();
  const p = prog(f, at, 12);
  return <div style={{position: 'absolute', left: `${(r.x - pad) * 100}%`, top: `${(r.y - pad) * 100}%`, width: `${(r.w + 2 * pad) * 100}%`, height: `${(r.h + 2 * pad) * 100}%`, border: `6px solid ${color}`, borderRadius: 14, boxShadow: `0 0 0 8px ${color}33, 0 0 40px ${color}88`, opacity: p, transform: `scale(${1.08 - 0.08 * p})`}} />;
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
        <Appear at={6}><div style={{fontSize: V ? 76 : 72, fontWeight: 800, overflowWrap: 'anywhere', lineHeight: 1.05, letterSpacing: -1.5}}>{title}</div></Appear>
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
      <AbsoluteFill style={{display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', gap: 56, padding: '110px 60px 150px'}}>
        <div style={{width: 960}}>{head}</div>
        <Appear at={4} dy={40}>{children}</Appear>
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill style={{display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 70, padding: '40px 80px 100px'}}>
      <div style={{width: 500, flexShrink: 0}}>{head}</div>
      <Appear at={4} dx={60} dy={0}>{children}</Appear>
    </AbsoluteFill>
  );
};

/** Echte Aufnahme passend zum Format: Desktop im Browser, Handy im Telefon. Kreuzblende zwischen mehreren Aufnahmen. */
const Real: React.FC<{shots: {name: string; at?: number; marks?: {key: string; at: number; color?: string; r?: R}[]; zoom?: [number, number]; focus?: [number, number]; zoomAt?: [number, number]}[]; url: string; en?: boolean}> = ({shots, url, en}) => {
  const {V} = useLayout();
  const f = useCurrentFrame();
  const k = V ? 'mob' : 'desk';
  const w = V ? 700 : 1240;
  const aspect = V ? 390 / 844 : 1440 / 900;
  return (
    <div style={{position: 'relative'}}>
      {shots.map((s, i) => {
        const base = rects[`${s.name}-${k}${en ? '-en' : ''}`] ? `${s.name}-${k}${en ? '-en' : ''}` : `${s.name}-${k}`;
        const next = shots[i + 1];
        const vis = (i === 0 ? 1 : prog(f, s.at ?? 0, 12)) * (next ? 1 - prog(f, next.at ?? 0, 12) : 1);
        return (
          <div key={s.name} style={{position: i === 0 ? 'relative' : 'absolute', inset: 0, opacity: vis}}>
            <Shot src={`real/uc/${base}.jpg`} aspect={aspect} w={w} phone={V} url={url} zoom={s.zoom} focus={s.focus} zoomAt={s.zoomAt}>
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
  const repSrc = V ? 'real/report-mobile-brief.jpg' : 'real/report-desktop.jpg';
  const scenes = [
    // 1 Problem
    <Center gap={34} key="p">
      <Pop at={2} bouncy><IAnchor size={170} color={C.blue} /></Pop>
      <Appear at={8}><Big size={120}>{t('Samstag segeln.', 'Sailing on Saturday.')}</Big></Appear>
      <Appear at={40}><Big size={120} color={C.flame}>{t('Hält das Wetter?', 'Will the weather hold?')}</Big></Appear>
    </Center>,
    // 2 Schritt 1
    <StepLayout key="s1" head={<StepHead n={1} title={t('Vorlage wählen', 'Pick a template')} sub={t('im Marktplatz', 'in the marketplace')} />}>
      <Real url={url} en={en} shots={[{name: 'gallery-cards', marks: [{key: 'cardbox', at: 30}], zoom: [1, V ? 1.08 : 1.35], focus: V ? [0.5, 0.45] : [0.75, 0.25], zoomAt: [20, 70]}]} />
    </StepLayout>,
    // 3 Schritt 2
    <StepLayout key="s2" head={<StepHead n={2} title={t('Angaben eintragen', 'Enter your details')} sub={t('Ort + ein Satz in deinen Worten', 'Place + one sentence in your words')} />}>
      <Real url={url} en={en} shots={[
        {name: 'nl-form-top', marks: [{key: 'ort', at: 20}], zoom: [1, 1.15], focus: [0.3, 0.25]},
        {name: 'nl-form-hint', at: Math.round(dLen(2) * 0.45), marks: [{key: 'hint', at: Math.round(dLen(2) * 0.45) + 10}], zoom: V ? [1, 1.1] : [1.35, 1.35], focus: V ? [0.5, 0.5] : [0.33, 0.5]},
      ]} />
    </StepLayout>,
    // 4 Schritt 3 (echtes Briefing aus echtem Lauf, Bremen)
    <StepLayout key="s3" head={<StepHead n={3} title={t('Ergebnis bekommen', 'Get the result')} sub={t('fertiges Briefing, echte Wetterdaten', 'finished briefing, real weather data')} />}>
      <div style={{position: 'relative'}}>
        <Shot src={repSrc} aspect={V ? 780 / 1688 : 2200 / 1600} w={V ? 700 : 1100} phone={V} url={`${url}/d/newsletter/out/report.html`} zoom={[1, V ? 1.1 : 1]} focus={V ? [0.5, 0.15] : [0.5, 0.45]} zoomAt={[10, 90]}>
          {V
            ? <Mark r={{x: 0.08, y: 0.066, w: 0.84, h: 0.26}} at={Math.round(dLen(3) * 0.5)} color={C.ok} />
            : <>
              <Mark r={{x: 0.03, y: 0.215, w: 0.94, h: 0.105}} at={30} color={C.blue} />
              <Mark r={{x: 0.03, y: 0.41, w: 0.94, h: 0.125}} at={Math.round(dLen(3) * 0.5)} color={C.ok} />
            </>}
        </Shot>
        <div style={{position: 'absolute', left: 0, right: 0, ...(V ? {top: -34} : {bottom: -70}), display: 'flex', justifyContent: 'center'}}>
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
        <Real url={url} en={en} shots={[{name: 'nl-check', marks: [{key: 'ok', at: Math.round(dLen(4) * 0.4) + 12, color: C.ok}], zoom: V ? [1.15, 1.15] : [1.35, 1.35], focus: V ? [0.5, 0.25] : [0.5, 0.25]}]} />
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
  const bubble = V ? {x: 0.17, y: 0.688, w: 0.586, h: 0.168} : {x: 0.296, y: 0.652, w: 0.347, h: 0.072};
  const scenes = [
    <StepLayout key="p" head={<StepHead title={t('Friseurtermin?', 'Need a haircut?')} sub={t('Einfach anrufen.', 'Just call.')} />}>
      <Real url={url} shots={[{name: 'cal-start', marks: [{key: 'call', at: 30}], zoom: [1, 1.2], focus: V ? [0.3, 0.6] : [0.35, 0.45]}]} />
    </StepLayout>,
    <StepLayout key="b" head={<StepHead title={t('Sagen, was du willst', 'Say what you want')} sub={t('Thomas bestätigt den Termin.', 'Thomas confirms the appointment.')} />}>
      <div style={{position: 'relative'}}>
        <Real url={url} shots={[{name: 'cal-booked', marks: [{key: 'b', at: Math.round(len(1) * 0.45), r: bubble, color: C.ok}], zoom: [1, V ? 1.2 : 1.75], focus: V ? [0.4, 0.8] : [0.47, 0.62], zoomAt: [5, 60]}]} />
        <div style={{position: 'absolute', left: 0, right: 0, ...(V ? {top: -34} : {bottom: -70}), display: 'flex', justifyContent: 'center'}}>
          <Appear at={20}><Chip color={C.blue} size={32} style={SOLID}>{V ? t('Echter Lauf · getippt', 'Real run · typed') : t('Echter Lauf · hier getippt statt gesprochen', 'Real run · typed here instead of spoken')}</Chip></Appear>
        </div>
      </div>
    </StepLayout>,
    <StepLayout key="c" head={<StepHead title={t('Absagen?', 'Cancel?')} sub={t('Ein Satz genügt.', 'One sentence is enough.')} />}>
      <Real url={url} shots={[{name: 'cal-cancel', marks: [{key: 'c', at: 14, r: bubble, color: C.ok}], zoom: [V ? 1.2 : 1.75, V ? 1.2 : 1.75], focus: V ? [0.4, 0.8] : [0.47, 0.62]}]} />
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
      <Real url={url} shots={[{name: 'cc-start', marks: [{key: 'call', at: 16}], zoom: [1, V ? 1.1 : 1.5], focus: [0.5, 0.3]}]} />
    </StepLayout>,
    <StepLayout key="r" head={<StepHead title={t('Antwort mit echten Zahlen', 'An answer with real figures')} sub={t('Quelle: Deutschlandatlas', 'Source: Deutschlandatlas')} />}>
      <div style={{position: 'relative'}}>
        <Real url={url} shots={[{name: 'cc-answer', marks: [{key: 'answer', at: Math.round(len(2) * 0.35)}, {key: 'src', at: Math.round(len(2) * 0.6), color: C.ok}], zoom: [1, V ? 1.12 : 1.6], focus: V ? [0.5, 0.8] : [0.5, 0.72], zoomAt: [10, 80]}]} />
        <div style={{position: 'absolute', left: 0, right: 0, ...(V ? {top: -34} : {bottom: -74}), display: 'flex', justifyContent: 'center'}}>
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

export const SoEinfachVideo = SoEinfach;
export const TerminVideo = Termin;
export const RegionVideo = Region;
