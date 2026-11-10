// Shared test data for the print renderer: the sample family with its places already located.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import topology50 from 'world-atlas/countries-50m.json';
import type { Topology } from 'topojson-specification';
import { parseGedcom, originEvent } from '../../src/gedcom';
import { computeGenerations } from '../../src/generations';
import type { Located } from '../../src/print/data';

/** Coordinates of every place in public/sample.ged (as a geocoder would return them). */
export const SAMPLE_PLACES: Record<string, [number, number]> = {
  'Lisboa, Portugal': [38.7223, -9.1393],
  'Porto, Portugal': [41.1579, -8.6291],
  'Braga, Portugal': [41.5454, -8.4265],
  'Viseu, Portugal': [40.6566, -7.9125],
  'Coimbra, Portugal': [40.2033, -8.4103],
  'Barcelos, Braga, Portugal': [41.5388, -8.6151],
  'Guimarães, Braga, Portugal': [41.4425, -8.2918],
  'Esposende, Braga, Portugal': [41.5326, -8.7813],
  'Lugar do Outeiro, Ponte de Lima, Viana do Castelo, Portugal': [41.7672, -8.5833],
  'Funchal, Madeira, Portugal': [32.6669, -16.9241],
  'Santana, Madeira, Portugal': [32.8058, -16.8817],
  'São Paulo, Brazil': [-23.5505, -46.6333],
  'Rio de Janeiro, Brazil': [-22.9068, -43.1729],
  'Boston, Massachusetts, USA': [42.3601, -71.0589],
  'New York, New York, USA': [40.7128, -74.006],
  'Vigo, Pontevedra, Spain': [42.2406, -8.7207],
  'Skibbereen, County Cork, Ireland': [51.55, -9.2667],
  'Cork, Ireland': [51.8985, -8.4756],
  'Kinsale, County Cork, Ireland': [51.7059, -8.5222],
  'Paris, France': [48.8566, 2.3522],
  'Lyon, France': [45.764, 4.8357],
  'Luanda, Angola': [-8.839, 13.2894],
  'Benguela, Angola': [-12.5763, 13.4055],
  'London, England, United Kingdom': [51.5074, -0.1278],
};

export function sampleTree() {
  const tree = parseGedcom(readFileSync(resolve(__dirname, '../../public/sample.ged'), 'utf8'));
  const gens = computeGenerations(tree);
  const located = new Map<string, Located>();
  for (const p of tree.people.values()) {
    const ev = originEvent(p)?.event;
    if (!ev?.place) continue;
    const c = ev.lat !== undefined && ev.lon !== undefined ? [ev.lat, ev.lon] : SAMPLE_PLACES[ev.place];
    if (c) located.set(p.id, { lat: c[0], lon: c[1], place: ev.place });
  }
  return { tree, gens, located };
}

export const topology = topology50 as unknown as Topology;

/** A stand-in flag: one colour, with an internal id like real flag-icons files have. */
export const fakeFlag = (code: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" id="flag-icons-${code}" viewBox="0 0 512 512"><defs><clipPath id="${code}-a"><path d="M0 0h512v512H0z"/></clipPath></defs><path clip-path="url(#${code}-a)" fill="#063" d="M0 0h512v512H0z"/></svg>`;
