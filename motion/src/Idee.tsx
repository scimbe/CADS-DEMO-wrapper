import React from 'react';
import {Sequence, interpolate, useCurrentFrame} from 'remotion';
import {C, F, sec} from './theme';
import {Appear, Big, Card, Center, Chip, Diamond, IBox, IKey, IShield, IWarn, Pop, Ring, SceneFade, Stage, Sub, Browser, prog, useLayout, useT} from './ui';

export const IDEE_LEN = sec(34);

const Title: React.FC = () => {
  const t = useT();
  return (
    <Center>
      <Appear at={4}><Diamond size={64} /></Appear>
      <Appear at={12}><Big size={140}>{t('Die Idee', 'The idea')}</Big></Appear>
      <Appear at={30}><Sub>{t('Agenten, denen man trauen kann', 'Agents you can trust')}</Sub></Appear>
    </Center>
  );
};

const Today: React.FC = () => {
  const t = useT();
  const f = useCurrentFrame();
  const {V} = useLayout();
  const shake = f > 130 ? Math.sin(f * 1.7) * Math.max(0, 6 - (f - 130) / 10) : 0;
  const bad = prog(f, 130, 10);
  return (
    <Center gap={50}>
      <Appear at={0}><Big>{t('Heute: blind vertrauen.', 'Today: blind trust.')}</Big></Appear>
      <div style={{display: 'flex', flexDirection: V ? 'column' : 'row', gap: 44, alignItems: 'stretch'}}>
        <Appear at={20} style={{transform: `translateX(${shake}px)`}}>
          <Card border={bad > 0.5 ? C.bad : C.line} style={{width: V ? 860 : 640, textAlign: 'left'}}>
            <Sub color={C.text} size={34} style={{fontWeight: 700, marginBottom: 22}}>{t('Prompt aus dem Netz', 'Prompt from the web')}</Sub>
            {[0.95, 0.8, 0.9, 0.55].map((w, i) => (<div key={i} style={{height: 18, width: `${w * 100}%`, background: C.panel2, borderRadius: 9, marginBottom: 14}} />))}
            <Appear at={70}><Chip color={C.bad}>{t('Absender: ?', 'Author: ?')}</Chip></Appear>
          </Card>
        </Appear>
        <Appear at={40} style={{transform: `translateX(${-shake}px)`}}>
          <Card border={bad > 0.5 ? C.bad : C.line} style={{width: V ? 860 : 640, textAlign: 'left'}}>
            <Sub color={C.text} size={34} style={{fontWeight: 700, marginBottom: 22}}>{t('Unbekannter Installer', 'Unknown installer')}</Sub>
            <div style={{fontFamily: F.mono, fontSize: 32, color: C.ok, background: '#070d19', padding: '20px 22px', borderRadius: 14, marginBottom: 22}}>$ curl https://… | sh</div>
            <Appear at={90}><Chip color={C.bad}>{t('Quelle: ?', 'Source: ?')}</Chip></Appear>
          </Card>
        </Appear>
      </div>
      <Pop at={130} bouncy><IWarn size={110} color={C.bad} /></Pop>
    </Center>
  );
};

const Pillar: React.FC<{at: number; icon: React.ReactNode; title: string; line: string; chip: string; color: string}> = ({at, icon, title, line, chip, color}) => (
  <Pop at={at} style={{flex: 1}}>
    <Card border={color} style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18, height: '100%', boxSizing: 'border-box'}}>
      {icon}
      <div style={{fontSize: 62, fontWeight: 800}}>{title}</div>
      <Sub size={34}>{line}</Sub>
      <Chip color={color} size={28}>{chip}</Chip>
    </Card>
  </Pop>
);

const Pillars: React.FC = () => {
  const t = useT();
  const {V} = useLayout();
  return (
    <Center gap={50}>
      <Appear at={0}><Big>{t('Wir drehen es um.', 'We flip it.')}</Big></Appear>
      <div style={{display: 'flex', flexDirection: V ? 'column' : 'row', gap: 36, width: V ? 940 : 1640, alignItems: 'stretch'}}>
        <Pillar at={25} color={C.ok} icon={<IShield size={120} color={C.ok} />} title={t('Signiert', 'Signed')} line={t('Jeder Baustein mit Prüfsumme', 'Every block pinned by digest')} chip="ed25519 · sha256" />
        <Pillar at={150} color={C.blue} icon={<IBox size={120} color={C.blue} />} title="Sandbox" line={t('Läuft immer abgeschottet', 'Always runs walled off')} chip={t('ohne Sandbox kein Start', 'no sandbox, no start')} />
        <Pillar at={275} color={C.flame} icon={<IKey size={120} color={C.flame} />} title={t('Dein Abo', 'Your plan')} line={t('Dein Claude, dein Konto', 'Your Claude, your account')} chip={t('Zugang bleibt lokal', 'credentials stay local')} />
      </div>
    </Center>
  );
};

const Proof: React.FC = () => {
  const t = useT();
  const f = useCurrentFrame();
  const {V} = useLayout();
  const w = V ? 960 : 1400;
  const h = V ? 640 : 700;
  const zoom = interpolate(f, [0, 70], [1.1, 2.0], {extrapolateRight: 'clamp'});
  const cx = interpolate(f, [0, 70], [0.5, 0.33], {extrapolateRight: 'clamp'});
  const cy = interpolate(f, [0, 70], [0.0, 0.272], {extrapolateRight: 'clamp'});
  return (
    <Center gap={36}>
      <Appear at={0}>
        <Browser src="real/signature-desktop.jpg" aspect={2880 / 1800} w={w} h={h} zoom={zoom} cx={cx} cy={cy}>
          <Ring x={0.155} y={0.193} w={0.36} h={0.048} at={70} />
        </Browser>
      </Appear>
      <Appear at={80}><Chip color={C.ok} size={40}>{t('Echt: im Browser geprüft (WebAssembly)', 'Real: verified in the browser (WebAssembly)')}</Chip></Appear>
    </Center>
  );
};

const Close: React.FC = () => {
  const t = useT();
  const {V} = useLayout();
  return (
    <Center gap={30}>
      <Appear at={0}><Big size={80}>{t('Vertrauen, das man prüfen kann.', 'Trust you can verify.')}</Big></Appear>
      <Appear at={12}><Browser src="real/gallery-desktop.jpg" aspect={2880 / 1800} w={V ? 900 : 880} h={V ? 560 : 400} url="bunsenbrenner.org" zoom={1} cx={0.5} cy={0} /></Appear>
      <Appear at={30}>
        <div style={{display: 'flex', gap: 20, flexWrap: 'wrap', justifyContent: 'center'}}>
          <Chip color={C.ok}>{t('signiert', 'signed')}</Chip>
          <Chip color={C.blue}>Sandbox</Chip>
          <Chip color={C.flame}>{t('dein Abo', 'your plan')}</Chip>
        </div>
      </Appear>
    </Center>
  );
};

export const Idee: React.FC = () => {
  const S = (from: number, to: number, el: React.ReactNode) => (
    <Sequence from={sec(from)} durationInFrames={sec(to - from)} premountFor={15}><SceneFade len={sec(to - from)}>{el}</SceneFade></Sequence>
  );
  return (
    <Stage>
      {S(0, 2.8, <Title />)}
      {S(2.8, 10.8, <Today />)}
      {S(10.8, 24.2, <Pillars />)}
      {S(24.2, 30.2, <Proof />)}
      {S(30.2, 34, <Close />)}
    </Stage>
  );
};
