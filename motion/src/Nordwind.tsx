import React from 'react';
import {Sequence, interpolate, useCurrentFrame} from 'remotion';
import {C, F, sec} from './theme';
import {Appear, Big, Card, Center, Chip, Diamond, ICheck, ICloud, ICross, IGpu, IKey, ILaptop, ILock, IServer, Phone, Pop, Ring, SceneFade, Stage, Sub, Typed, prog, useLayout, useT} from './ui';

export const NORDWIND_LEN = sec(45);
const NOTE = 'Segelgruppe, Wind und Regen hervorheben';
const TPL = 'Törn-Briefing Samstag Bremen';

const Title: React.FC = () => {
  const t = useT();
  return (
    <Center gap={30}>
      <Appear at={4}><IAnchorLogo /></Appear>
      <Appear at={12}><Big size={110}>{t('Nordwind — ein echter Tag', 'Nordwind — one real day')}</Big></Appear>
      <Appear at={30}><Sub>Nordwind Bootsservice GmbH</Sub></Appear>
      <Appear at={50}><Chip color={C.warn} size={30}>{t('Szenario · der Wetterteil läuft live', 'Scenario · the weather part runs live')}</Chip></Appear>
    </Center>
  );
};
const IAnchorLogo: React.FC = () => <Diamond size={60} />;

const Fill: React.FC = () => {
  const t = useT();
  const f = useCurrentFrame();
  const {V} = useLayout();
  const sc = interpolate(f, [50, 230], [0, 0.9], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return (
    <Center gap={V ? 40 : 0} style={{flexDirection: V ? 'column' : 'row', gap: V ? 40 : 110}}>
      <Appear at={0} dx={-60} dy={0}>
        <Phone src="real/form-mobile.jpg" aspect={780 / 3000} w={V ? 430 : 470} scroll={sc} />
      </Appear>
      <div style={{display: 'flex', flexDirection: 'column', gap: 30, alignItems: V ? 'center' : 'flex-start', textAlign: V ? 'center' : 'left', maxWidth: V ? 900 : 900}}>
        <Appear at={10}><Chip color={C.blue} size={32}>{t('Außendienst · Android', 'Field staff · Android')}</Chip></Appear>
        <Appear at={25}><Big size={74}>{TPL}</Big></Appear>
        <Appear at={45}><Chip color={C.ok} size={32}><ICheck size={30} color={C.ok} />{t('Signatur geprüft', 'signature verified')}</Chip></Appear>
        <Appear at={70}>
          <Card border={C.flame} style={{padding: '22px 30px', textAlign: 'left'}}>
            <div style={{fontSize: 26, color: C.mute, marginBottom: 6}}>{t('Eigener Hinweis', 'Own note')}</div>
            <div style={{fontSize: 40, fontWeight: 700, minHeight: V ? 100 : 52}}><Typed text={NOTE} at={85} cps={18} /></div>
          </Card>
        </Appear>
      </div>
    </Center>
  );
};

const Save: React.FC = () => {
  const t = useT();
  const f = useCurrentFrame();
  const {V} = useLayout();
  const slide = prog(f, 40, 30);
  return (
    <Center gap={50}>
      <Appear at={0}><Big>{t('Gespeichert im Konto.', 'Saved in the account.')}</Big></Appear>
      <div style={{display: 'flex', alignItems: 'center', gap: 40, flexDirection: V ? 'column' : 'row'}}>
        <Appear at={10}><Card border={C.blue} style={{padding: 26}}><div style={{fontSize: 36, fontWeight: 700, opacity: 1 - slide * 0.6}}>{TPL}</div></Card></Appear>
        <div style={{fontSize: 70, color: C.mute, transform: V ? 'rotate(90deg)' : 'none'}}>→</div>
        <Pop at={30}>
          <Card border={C.flame} style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, minWidth: 520}}>
            <ICloud size={100} color={C.flame} />
            <div style={{fontSize: 40, fontWeight: 800}}>bunsenbrenner.org</div>
            <div style={{opacity: slide, transform: `translateY(${(1 - slide) * -30}px)`}}><Chip color={C.ok} size={28}>{TPL} · v1</Chip></div>
          </Card>
        </Pop>
      </div>
      <Appear at={90}><Sub>{t('Anpassen, Versionen, auf jedem Gerät abrufbar', 'Adapt, versions, retrieve on any device')}</Sub></Appear>
    </Center>
  );
};

type P = {x: number; y: number};
const NodeBox: React.FC<{p: P; at: number; w: number; icon: React.ReactNode; name: string; sub: string; color: string; children?: React.ReactNode}> = ({p, at, w, icon, name, sub, color, children}) => (
  <div style={{position: 'absolute', left: p.x - w / 2, top: p.y - 90, width: w}}>
    <Pop at={at}>
      <Card border={color} style={{padding: 22, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, boxSizing: 'border-box'}}>
        {icon}
        <div style={{fontSize: 36, fontWeight: 800, lineHeight: 1.1}}>{name}</div>
        <div style={{fontSize: 26, color: C.mute}}>{sub}</div>
        {children}
      </Card>
    </Pop>
  </div>
);

const Network: React.FC = () => {
  const t = useT();
  const f = useCurrentFrame();
  const {V} = useLayout();
  const box = V ? {w: 940, h: 1260} : {w: 1700, h: 800};
  const edge: P = V ? {x: 470, y: 250} : {x: 850, y: 140};
  const ham: P = V ? {x: 235, y: 700} : {x: 330, y: 560};
  const haf: P = V ? {x: 705, y: 700} : {x: 1370, y: 560};
  const gpu: P = V ? {x: 470, y: 1100} : {x: 850, y: 620};
  const nw = V ? 420 : 440;
  const line = (a: P, b: P, at: number, color: string) => {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const p = prog(f, at, 24);
    return <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} strokeWidth={6} strokeDasharray={`${len}`} strokeDashoffset={len * (1 - p)} strokeLinecap="round" />;
  };
  const packet = (a: P, b: P, c: P, start: number, color: string) => {
    const cycle = 80;
    if (f < start) return null;
    const tt = ((f - start) % cycle) / cycle;
    const seg = tt < 0.5 ? [a, b, tt * 2] : [b, c, (tt - 0.5) * 2];
    const [s, e, k] = seg as [P, P, number];
    return <circle cx={s.x + (e.x - s.x) * k} cy={s.y + (e.y - s.y) * k} r={13} fill={color} />;
  };
  const head1 = 1 - prog(f, 135, 10);
  const head2 = prog(f, 145, 12);
  const mid = (a: P, b: P): P => ({x: (a.x + b.x) / 2, y: (a.y + b.y) / 2});
  return (
    <Center gap={20} style={{justifyContent: 'flex-start', paddingTop: V ? 70 : 50}}>
      <div style={{position: 'relative', height: V ? 120 : 100, width: '100%'}}>
        <div style={{position: 'absolute', left: 0, right: 0, opacity: head1}}><Appear at={0}><Big size={70}>{t('Zentrale Hamburg führt aus.', 'Head office Hamburg runs it.')}</Big></Appear></div>
        <div style={{position: 'absolute', left: 0, right: 0, opacity: head2}}><Big size={70}>{t('Werkstatt und Hafen helfen mit.', 'Workshop and harbour join in.')}</Big></div>
      </div>
      <div style={{position: 'relative', width: box.w, height: box.h}}>
        <svg width={box.w} height={box.h} style={{position: 'absolute', left: 0, top: 0}}>
          {line(ham, edge, 100, C.blue)}
          {line(gpu, edge, 165, C.blue)}
          {line(haf, edge, 175, C.blue)}
          {f > 230 && packet(ham, edge, gpu, 230, C.flame)}
          {f > 250 && packet(gpu, edge, haf, 250, C.ok)}
        </svg>
        {f > 215 && [mid(ham, edge), mid(gpu, edge), mid(haf, edge)].map((m, i) => (
          <Pop key={i} at={215 + i * 6} style={{position: 'absolute', left: m.x - 34, top: m.y - 34, background: C.bg, borderRadius: 40, padding: 6}}><ILock size={56} color={C.ok} /></Pop>
        ))}
        <NodeBox p={edge} at={95} w={V ? 460 : 500} icon={<ICloud size={64} color={C.mute} />} name="CADS-Edge" sub={t('sieht nur Chiffre', 'sees ciphertext only')} color={C.mute} />
        <NodeBox p={ham} at={20} w={nw} icon={<ILaptop size={70} color={C.flame} />} name={t('Zentrale Hamburg', 'HQ Hamburg')} sub="Mac" color={C.flame}>
          <div style={{border: `3px dashed ${C.blue}`, borderRadius: 16, padding: '8px 14px', marginTop: 6, display: 'flex', alignItems: 'center', gap: 10, opacity: prog(f, 45, 14)}}>
            <IKey size={40} color={C.flame} /><span style={{fontSize: 26, fontWeight: 700}}>{t('eigenes Claude-Abo', 'own Claude plan')}</span>
          </div>
          <div style={{opacity: prog(f, 60, 14), fontSize: 24, color: C.blue, fontWeight: 700}}>Sandbox</div>
        </NodeBox>
        <NodeBox p={gpu} at={150} w={nw} icon={<IGpu size={70} color={C.ok} />} name={t('Werkstatt-GPU', 'Workshop GPU')} sub={t('lokales LLM', 'local LLM')} color={C.ok} />
        <NodeBox p={haf} at={158} w={nw} icon={<IServer size={70} color={C.ok} />} name={t('Hafenbüro Bremen', 'Harbour office Bremen')} sub="Linux" color={C.ok} />
        <div style={{position: 'absolute', left: 0, right: 0, bottom: V ? 20 : 0, display: 'flex', justifyContent: 'center', gap: 16, flexWrap: 'wrap', opacity: prog(f, 290, 16)}}>
          <Chip color={C.blue} size={28}>{t('nur ausgehend · keine offenen Ports', 'outbound only · no open ports')}</Chip>
          <Chip color={C.ok} size={28}><ILock size={28} color={C.ok} />{t('Ende-zu-Ende (Noise)', 'end-to-end (Noise)')}</Chip>
        </div>
      </div>
    </Center>
  );
};

const Back: React.FC = () => {
  const t = useT();
  const f = useCurrentFrame();
  const {V} = useLayout();
  const scroll = interpolate(f, [60, 220], [0, 0.55], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return (
    <Center style={{flexDirection: V ? 'column' : 'row', gap: V ? 40 : 120}}>
      <div style={{display: 'flex', flexDirection: 'column', gap: 30, alignItems: V ? 'center' : 'flex-start', textAlign: V ? 'center' : 'left', maxWidth: 800}}>
        <Appear at={0}><Big size={84}>{t('Zurück aufs Handy.', 'Back on the phone.')}</Big></Appear>
        <Appear at={25}><Chip color={C.ok} size={34}>{t('Echtes Briefing, echte Daten', 'Real briefing, real data')}</Chip></Appear>
        <Appear at={45}><Sub>{t('Wetter: Open-Meteo · Text: Sprachmodell', 'Weather: Open-Meteo · text: language model')}</Sub></Appear>
      </div>
      <Pop at={8}>
        <Phone src="real/report-mobile-brief.jpg" aspect={780 / 1688} w={V ? 440 : 480} scroll={scroll}>
          <Ring x={0.07} y={0.075} w={0.86} h={0.26} at={30} color={C.flame} />
        </Phone>
      </Pop>
    </Center>
  );
};

const Finale: React.FC = () => {
  const t = useT();
  const {V} = useLayout();
  return (
    <Center gap={34}>
      <Appear at={0}>
        <div style={{fontSize: V ? 54 : 64, fontWeight: 800, lineHeight: 1.2, maxWidth: V ? 940 : 1500, color: C.text}}>
          <span style={{color: C.flame}}>„</span>Für fünf Tage bleibt es trocken, was Outdoor-Aktivitäten wie Segeln begünstigt.<span style={{color: C.flame}}>“</span>
        </div>
      </Appear>
      <Appear at={30}><Sub size={34}>{t('Echter Lauf · Bremen · Segelgruppe-Hinweis berücksichtigt', 'Real run · Bremen · sailing-group note applied')}</Sub></Appear>
      <Appear at={55}>
        <div style={{display: 'flex', gap: 18, flexWrap: 'wrap', justifyContent: 'center'}}>
          <Chip color={C.ok}>{t('signiert', 'signed')}</Chip>
          <Chip color={C.blue}>Sandbox</Chip>
          <Chip color={C.flame}>{t('dein Abo', 'your plan')}</Chip>
        </div>
      </Appear>
      <Appear at={85}><Chip color={C.warn} size={26}>{t('Szenario · Wetterteil live · Screenshots echt', 'Scenario · weather part live · screenshots real')}</Chip></Appear>
    </Center>
  );
};

export const Nordwind: React.FC = () => {
  const S = (from: number, to: number, el: React.ReactNode) => (
    <Sequence from={sec(from)} durationInFrames={sec(to - from)} premountFor={15}><SceneFade len={sec(to - from)}>{el}</SceneFade></Sequence>
  );
  return (
    <Stage>
      {S(0, 3.5, <Title />)}
      {S(3.5, 12, <Fill />)}
      {S(12, 17, <Save />)}
      {S(17, 31, <Network />)}
      {S(31, 38.5, <Back />)}
      {S(38.5, 45, <Finale />)}
    </Stage>
  );
};
