import React from 'react';
import {Sequence, interpolate, useCurrentFrame} from 'remotion';
import {C, F, sec} from './theme';
import {Appear, Big, Browser, Card, Center, Chip, Diamond, IBox, ICheck, ICross, IShield, Pop, Ring, SceneFade, Stage, Sub, prog, useLayout, useT} from './ui';

export const HERKUNFT_LEN = sec(37);

const Title: React.FC = () => {
  const t = useT();
  return (
    <Center>
      <Appear at={4}><Diamond size={56} /></Appear>
      <Appear at={12}><Big size={110}>{t('Herkunft, die man prüfen kann', 'Provenance you can verify')}</Big></Appear>
    </Center>
  );
};

const Row: React.FC<{at: number; icon: React.ReactNode; label: string; children: React.ReactNode}> = ({at, icon, label, children}) => (
  <Appear at={at} dy={20}>
    <div style={{display: 'flex', alignItems: 'center', gap: 26, padding: '22px 0', borderTop: `2px solid ${C.line}`, textAlign: 'left'}}>
      <div style={{width: 90}}>{icon}</div>
      <div style={{flex: 1}}>
        <div style={{fontSize: 30, color: C.mute, marginBottom: 8}}>{label}</div>
        {children}
      </div>
    </div>
  </Appear>
);

const Chain: React.FC = () => {
  const t = useT();
  const {V} = useLayout();
  return (
    <Center gap={40}>
      <Appear at={0}><Big size={76}>{t('Jeder Baustein: festgenagelt.', 'Every block: pinned.')}</Big></Appear>
      <Appear at={10}>
        <Card border={C.ok} style={{width: V ? 940 : 1300}}>
          <div style={{fontFamily: F.mono, fontSize: 40, fontWeight: 700, textAlign: 'left', marginBottom: 14}}>newsletter-wetter-briefing 1.0.0</div>
          <Row at={35} icon={<IBox size={70} color={C.blue} />} label={t('Baustein', 'Block')}>
            <div style={{display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap'}}><span style={{fontFamily: F.mono, fontSize: 34}}>newsletter-bundle</span><Chip mono color={C.ok} size={28}>sha256 e2c5172aec10646a…</Chip></div>
          </Row>
          <Row at={90} icon={<ICheck size={70} color={C.warn} />} label={t('Hinweis des Herausgebers (signiert)', 'Publisher note (signed)')}>
            <div style={{fontSize: 34}}>{t('wie der Baustein gedacht ist', 'how the block is meant to be used')}</div>
          </Row>
          <Row at={145} icon={<IShield size={70} color={C.ok} />} label={t('Herausgeber-Signatur', 'Publisher signature')}>
            <Chip mono color={C.ok} size={28}>ed25519 · 6266be1f792ba324…</Chip>
          </Row>
        </Card>
      </Appear>
    </Center>
  );
};

const Verify: React.FC = () => {
  const t = useT();
  const f = useCurrentFrame();
  const {V} = useLayout();
  const cy = interpolate(f, [0, 90], [0.42, 0.272], {extrapolateRight: 'clamp'});
  return (
    <Center gap={34}>
      <Appear at={0}>
        <Browser src="real/signature-desktop.jpg" aspect={2880 / 1800} w={V ? 960 : 1400} h={V ? 700 : 680} zoom={V ? 2.3 : 1.9} cx={0.33} cy={cy}>
          <Ring x={0.16} y={0.385} w={0.23} h={0.045} at={20} color={C.blue} />
          <Ring x={0.155} y={0.193} w={0.36} h={0.048} at={95} />
        </Browser>
      </Appear>
      <Appear at={20}><Chip color={C.ok} size={40}>{t('Im Browser geprüft: WebAssembly', 'Checked in your browser: WebAssembly')}</Chip></Appear>
    </Center>
  );
};

const Inputs: React.FC = () => {
  const t = useT();
  const {V} = useLayout();
  return (
    <Center gap={34}>
      <Appear at={0}>
        <Browser src="real/preview-desktop.jpg" aspect={2880 / 1800} w={V ? 960 : 1400} h={V ? 700 : 640} zoom={V ? 2.0 : 1.8} cx={V ? 0.43 : 0.4} cy={0.74}>
          <Ring x={0.225} y={0.695} w={0.4} h={0.05} at={30} color={C.flame} />
        </Browser>
      </Appear>
      <Appear at={30}><Chip color={C.flame} size={42}>{t('Dein Text = Angabe, keine Anweisung', 'Your text = data, not instructions')}</Chip></Appear>
    </Center>
  );
};

const Digests: React.FC = () => {
  const t = useT();
  const {V} = useLayout();
  const box = (at: number, key: string, val: string, sub: string, color: string) => (
    <Pop at={at} style={{flex: 1}}>
      <Card border={color} style={{textAlign: 'left'}}>
        <div style={{fontFamily: F.mono, fontSize: 36, color, fontWeight: 700}}>{key}</div>
        <div style={{fontFamily: F.mono, fontSize: 44, margin: '14px 0'}}>{val}</div>
        <Sub size={34}>{sub}</Sub>
      </Card>
    </Pop>
  );
  return (
    <Center gap={44}>
      <Appear at={0}><Big size={76}>{t('Das Ergebnis trägt den Nachweis.', 'The result carries its proof.')}</Big></Appear>
      <div style={{display: 'flex', flexDirection: V ? 'column' : 'row', gap: 32, width: V ? 940 : 1500}}>
        {box(25, 'template_digest', '94531afc3679f313…', t('welche signierte Vorlage', 'which signed template'), C.ok)}
        {box(50, 'values_digest', 'aef09c6137eaeef0…', t('welche Angaben', 'which inputs'), C.flame)}
      </div>
      <Appear at={80}><Sub size={30}>{t('Werte aus der Live-Demo', 'Values from the live demo')}</Sub></Appear>
    </Center>
  );
};

const HEX = '0123456789abcdef';
const Tamper: React.FC = () => {
  const t = useT();
  const f = useCurrentFrame();
  const {V} = useLayout();
  const changed = f >= 75;
  const settled = f >= 100;
  const orig = '4d9d712742662b84';
  const done = '1f5189484288da21';
  const hash = !changed ? orig : settled ? done : orig.split('').map((_, i) => HEX[(f * 7 + i * 13) % 16]).join('');
  const bad = prog(f, 75, 8);
  const shake = changed && f < 100 ? Math.sin(f * 2.1) * 8 * (1 - (f - 75) / 25) : 0;
  const color = bad > 0.5 ? C.bad : C.ok;
  const w = V ? 960 : 1500;
  return (
    <Center gap={36}>
      <Appear at={0}><Big size={72}>{t('Ein Wort geändert …', 'One word changed …')}</Big></Appear>
      <Appear at={10} style={{transform: `translateX(${shake}px)`}}>
        <Card border={color} style={{width: w, textAlign: 'left', position: 'relative'}}>
          <div style={{position: 'absolute', top: -20, right: 28}}><Chip color={C.mute} size={24}>{t('Beispiel', 'Example')}</Chip></div>
          <div style={{fontFamily: F.mono, fontSize: V ? 32 : 38, lineHeight: 1.4}}>
            Verwende ausschliesslich die Zahlen aus den Wetterdaten, und erfinde{' '}
            <span style={{background: changed ? `${C.bad}55` : 'transparent', color: changed ? C.bad : C.text, padding: '0 6px', borderRadius: 6, fontWeight: 700}}>{changed ? 'ruhig' : 'keine'}</span> Werte.
          </div>
          <div style={{display: 'flex', alignItems: 'center', gap: 18, marginTop: 30, flexWrap: 'wrap'}}>
            <Chip mono color={color} size={30}>sha256 {hash}…</Chip>
            <div style={{display: 'flex', alignItems: 'center', gap: 12, color, fontSize: 44, fontWeight: 800}}>
              {bad > 0.5 ? <ICross size={56} color={C.bad} /> : <ICheck size={56} color={C.ok} />}
              {bad > 0.5 ? t('Signatur ungültig', 'Signature invalid') : t('Signatur gültig', 'Signature valid')}
            </div>
          </div>
        </Card>
      </Appear>
      <Appear at={120}><Big size={80} color={C.ok}>{t('Prüfen statt vertrauen.', 'Verify, don’t trust.')}</Big></Appear>
    </Center>
  );
};

export const Herkunft: React.FC = () => {
  const S = (from: number, to: number, el: React.ReactNode) => (
    <Sequence from={sec(from)} durationInFrames={sec(to - from)} premountFor={15}><SceneFade len={sec(to - from)}>{el}</SceneFade></Sequence>
  );
  return (
    <Stage>
      {S(0, 3, <Title />)}
      {S(3, 10.5, <Chain />)}
      {S(10.5, 17.5, <Verify />)}
      {S(17.5, 24.5, <Inputs />)}
      {S(24.5, 29.5, <Digests />)}
      {S(29.5, 37, <Tamper />)}
    </Stage>
  );
};
