import React from 'react';
import {Sequence, useCurrentFrame} from 'remotion';
import {C, F, sec} from './theme';
import {Appear, Big, Card, Center, Chip, Diamond, IBox, ICheck, ICross, ILaptop, ILock, IPhone, IServer, Pop, SceneFade, Stage, Sub, prog, useLayout, useT} from './ui';

export const SICHER_LEN = sec(34);

const Title: React.FC = () => {
  const t = useT();
  return (
    <Center>
      <Appear at={4}><Diamond size={56} /></Appear>
      <Appear at={12}><Big size={120}>{t('Sicher auf jedem Gerät', 'Safe on every device')}</Big></Appear>
    </Center>
  );
};

type Dev = {key: string; icon: React.ReactNode; name: string; tech: string; soon: boolean; passed: boolean};
const Tile: React.FC<{d: Dev; at: number; w: number; badgeAt: number}> = ({d, at, w, badgeAt}) => {
  const t = useT();
  const color = d.soon ? C.warn : C.ok;
  return (
    <Pop at={at}>
      <Card border={color} style={{width: w, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: 28}}>
        {d.icon}
        <div style={{fontSize: 54, fontWeight: 800}}>{d.name}</div>
        <Chip mono color={C.blue} size={26}>{d.tech}</Chip>
        <div style={{height: 56, display: 'flex', alignItems: 'center'}}>
          <Appear at={badgeAt} dy={10}>
            {d.soon ? <Chip color={C.warn} size={30}>{t('in Vorbereitung', 'in preparation')}</Chip> : <Chip color={C.ok} size={30}>{t('Ausbruchstest bestanden', 'escape test passed')}</Chip>}
          </Appear>
        </div>
      </Card>
    </Pop>
  );
};

const devices = (t: (de: string, en: string) => string): Dev[] => [
  {key: 'mac', icon: <ILaptop size={96} color={C.text} />, name: 'macOS', tech: 'Seatbelt', soon: false, passed: true},
  {key: 'linux', icon: <IServer size={96} color={C.text} />, name: 'Linux', tech: 'bubblewrap', soon: false, passed: true},
  {key: 'win', icon: <ILaptop size={96} color={C.mute} />, name: 'Windows', tech: 'WSL2 + bubblewrap', soon: true, passed: false},
  {key: 'and', icon: <IPhone size={96} color={C.mute} />, name: 'Android', tech: 'WebAssembly', soon: true, passed: false},
];

const Devices: React.FC = () => {
  const t = useT();
  const {V} = useLayout();
  const ds = devices(t);
  const w = V ? 450 : 390;
  return (
    <Center gap={44}>
      <Appear at={0}><Big>{t('Dieselbe Installation.', 'The same installation.')}</Big></Appear>
      <div style={{display: 'flex', flexWrap: 'wrap', gap: 30, justifyContent: 'center', width: V ? 940 : 1700}}>
        {ds.map((d, i) => (<Tile key={d.key} d={d} at={30 + i * 22} w={w} badgeAt={150 + i * 14} />))}
      </div>
    </Center>
  );
};

const EscapeBox: React.FC<{name: string; tech: string; at: number}> = ({name, tech, at}) => {
  const t = useT();
  const f = useCurrentFrame();
  const {V} = useLayout();
  const grow = prog(f, at + 70, 22);
  const hit = f >= at + 92;
  const shake = hit && f < at + 104 ? Math.sin(f * 2.5) * 6 : 0;
  return (
    <Appear at={at} style={{transform: `translateX(${shake}px)`}}>
      <Card border={hit ? C.ok : C.line} style={{width: V ? 940 : 820, boxSizing: 'border-box'}}>
        <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 26}}>
          <div style={{fontSize: 52, fontWeight: 800}}>{name}</div>
          <Chip mono color={C.blue} size={26}>{tech}</Chip>
        </div>
        <div style={{display: 'flex', alignItems: 'center', height: 190}}>
          <div style={{width: 250, height: 190, border: `4px dashed ${C.blue}`, borderRadius: 22, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, background: `${C.blue}12`}}>
            <IBox size={64} color={C.blue} />
            <div style={{fontSize: 28, color: C.blue, fontWeight: 700}}>Sandbox</div>
          </div>
          <div style={{flex: 1, position: 'relative', height: 190}}>
            <div style={{position: 'absolute', top: 95 - 3, left: 0, height: 6, width: `${grow * 46}%`, background: hit ? C.bad : C.flame, borderRadius: 3}} />
            <div style={{position: 'absolute', top: 30, left: '48%', width: 10, height: 130, background: C.blue, borderRadius: 5, opacity: 0.9}} />
            {hit && <Pop at={at + 92} bouncy style={{position: 'absolute', top: 60, left: '48%', marginLeft: -26}}><ICross size={66} color={C.bad} /></Pop>}
          </div>
          <div style={{width: 200, height: 120, border: `3px solid ${C.line}`, borderRadius: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', fontSize: 26, color: C.mute, padding: 10, boxSizing: 'border-box'}}>
            {t('Dateien außerhalb', 'Files outside')}
          </div>
        </div>
        <div style={{height: 64, marginTop: 18, display: 'flex', gap: 16, alignItems: 'center'}}>
          {hit && <Appear at={at + 100} dy={10}><Chip color={C.bad} size={32}>{t('Ausbruch blockiert', 'escape blocked')}</Chip></Appear>}
          {f > at + 150 && <Appear at={at + 150} dy={10}><Chip color={C.ok} size={32}><ICheck size={30} color={C.ok} />{t('Test bestanden', 'test passed')}</Chip></Appear>}
        </div>
      </Card>
    </Appear>
  );
};

const Escape: React.FC = () => {
  const t = useT();
  const {V} = useLayout();
  return (
    <Center gap={40}>
      <Appear at={0}><Big>{t('Ausbruchsversuch? Blockiert.', 'Escape attempt? Blocked.')}</Big></Appear>
      <div style={{display: 'flex', flexDirection: V ? 'column' : 'row', gap: 36}}>
        <EscapeBox name="macOS" tech="Seatbelt" at={20} />
        <EscapeBox name="Linux" tech="bubblewrap" at={50} />
      </div>
    </Center>
  );
};

const Policy: React.FC = () => {
  const t = useT();
  const f = useCurrentFrame();
  const {V} = useLayout();
  const ds = devices(t);
  const off = prog(f, 40, 12);
  return (
    <Center gap={44}>
      <Appear at={0}><Big>{t('Keine Sandbox? Kein Start.', 'No sandbox? No start.')}</Big></Appear>
      <Appear at={15}>
        <Card border={off > 0.5 ? C.bad : C.line} style={{display: 'flex', alignItems: 'center', gap: 34, padding: '28px 44px'}}>
          <div style={{opacity: off > 0.5 ? 0.35 : 1, fontSize: 52, fontWeight: 800, background: C.flame, color: '#1a0d00', padding: '14px 40px', borderRadius: 18}}>▶ {t('Starten', 'Run')}</div>
          <div style={{opacity: off, display: 'flex', alignItems: 'center', gap: 16, color: C.bad, fontSize: 44, fontWeight: 800}}><ILock size={56} color={C.bad} />{t('Sandbox fehlt', 'sandbox missing')}</div>
        </Card>
      </Appear>
      <Appear at={110}>
        <div style={{display: 'flex', flexWrap: 'wrap', gap: 20, justifyContent: 'center', width: V ? 940 : 1500}}>
          {ds.map((d) => (
            <Chip key={d.key} color={d.soon ? C.warn : C.ok} size={34}>
              {d.soon ? null : <ICheck size={34} color={C.ok} />}
              {d.name}{d.soon ? ` · ${t('in Vorbereitung', 'in preparation')}` : ''}
            </Chip>
          ))}
        </div>
      </Appear>
    </Center>
  );
};

export const Sicher: React.FC = () => {
  const S = (from: number, to: number, el: React.ReactNode) => (
    <Sequence from={sec(from)} durationInFrames={sec(to - from)} premountFor={15}><SceneFade len={sec(to - from)}>{el}</SceneFade></Sequence>
  );
  return (
    <Stage>
      {S(0, 3, <Title />)}
      {S(3, 12.5, <Devices />)}
      {S(12.5, 24.5, <Escape />)}
      {S(24.5, 34, <Policy />)}
    </Stage>
  );
};
