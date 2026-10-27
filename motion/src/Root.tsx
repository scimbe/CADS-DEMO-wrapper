import React from 'react';
import {Composition} from 'remotion';
import {FPS} from './theme';
import {Lang, LangCtx} from './ui';
import {Idee, IDEE_LEN} from './Idee';
import {Herkunft, HERKUNFT_LEN} from './Herkunft';
import {Sicher, SICHER_LEN} from './Sicher';
import {Nordwind, NORDWIND_LEN} from './Nordwind';

export type Props = {lang: Lang};
const wrap = (C: React.FC): React.FC<Props> => ({lang}) => (
  <LangCtx.Provider value={lang}><C /></LangCtx.Provider>
);

const vids = [
  {id: 'Idee', C: wrap(Idee), len: IDEE_LEN},
  {id: 'Herkunft', C: wrap(Herkunft), len: HERKUNFT_LEN},
  {id: 'Sicher', C: wrap(Sicher), len: SICHER_LEN},
  {id: 'Nordwind', C: wrap(Nordwind), len: NORDWIND_LEN},
];
const fmts = [
  {k: '16x9', w: 1920, h: 1080},
  {k: '9x16', w: 1080, h: 1920},
];

export const Root: React.FC = () => (
  <>
    {vids.flatMap((v) =>
      fmts.map((f) => (
        <Composition key={`${v.id}-${f.k}`} id={`${v.id}-${f.k}`} component={v.C} durationInFrames={v.len} fps={FPS} width={f.w} height={f.h} defaultProps={{lang: 'de'} as Props} />
      )),
    )}
  </>
);
