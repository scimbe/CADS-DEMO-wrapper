// Uebergabe zwischen Zugkarte und freier Karte (Strang K): Doc der freien Karte {k:"turn", i:<alte Katalog-id>, t?, w?}
// <-> Parameter dieser Karte. Unbekanntes ergibt null (kein stiller Ersatz). Das Siegel der freien Karte (ki, fr)
// reist in den Parametern mit (Strang K, engines/frei/seal.js): Status-Gate beim Empfaenger und "Mit KI erstellt".
import { clean } from "../zug/alt.js";
import { sealParams, sealDoc } from "../frei/seal.js";

/** @param {object} manifest  @param {{variants?:Object<string,string>, word?:boolean}} opt variants: alte id -> params.spiel */
/** Standardwerte aus dem Parameterschema (wie contract/fields.js defaults; Engines importieren nur SDK-Teile). */
function defaults(schema) { const out = {}; for (const k of Object.keys(schema.properties || {})) if ("default" in schema.properties[k]) out[k] = JSON.parse(JSON.stringify(schema.properties[k].default)); return out; }

export function freeHooks(manifest, opt = {}) {
  const props = manifest.params.properties, variants = opt.variants || {};
  const ids = [manifest.id].concat(Object.keys(variants));
  return {
    fromFree(doc) {
      if (!doc || doc.k !== "turn" || !ids.includes(doc.i)) return null;
      const p = defaults(manifest.params);
      if (variants[doc.i]) p.spiel = variants[doc.i];
      if (doc.t !== undefined) { if (!props.title) return null; const t = clean(doc.t, props.title.maxLength); if (doc.t && !t) return null; p.title = t; }
      if (doc.w !== undefined) { if (!opt.word) return null; const w = clean(doc.w, 14); if (doc.w && !w) return null; p.w = w; }
      return { ...p, ...sealParams(doc, props) };
    },
    toFree(params) {
      const back = Object.keys(variants).find((k) => variants[k] === params.spiel && k.startsWith("zug-")) || Object.keys(variants).find((k) => variants[k] === params.spiel);
      const doc = { k: "turn", i: params.spiel && props.spiel && params.spiel !== props.spiel.default && back ? back : manifest.id };
      if (params.title) doc.t = params.title;
      if (opt.word && params.w) doc.w = params.w;
      return { ...doc, ...sealDoc(params) };
    }
  };
}
