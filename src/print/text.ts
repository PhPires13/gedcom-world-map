// Words printed on the map, in Portuguese and English.

import type { Lang } from './types';

export const STRINGS = {
  pt: {
    legend: 'Legenda',
    generationOf: (years: string) => `Geração de ${years}`,
    generation: (r: string) => `${r}.ª geração`,
    birthplace: 'Local de nascimento',
    origin: 'País de origem',
    scale: 'Escala de quilómetros',
    scaleEquator: 'Escala de quilómetros, no equador',
    family: (surname: string) => `Família ${surname}`,
  },
  en: {
    legend: 'Legend',
    generationOf: (years: string) => `Generation of ${years}`,
    generation: (r: string) => `Generation ${r}`,
    birthplace: 'Place of birth',
    origin: 'Country of origin',
    scale: 'Scale of kilometres',
    scaleEquator: 'Scale of kilometres at the equator',
    family: (surname: string) => `The ${surname} Family`,
  },
} satisfies Record<Lang, unknown>;

/** Oceans and seas, with spots to write their names (tried in order until one fits). */
export const WATERS: { name: Record<Lang, string>; at: [number, number][]; major: boolean }[] = [
  {
    name: { pt: 'Oceano Atlântico', en: 'Atlantic Ocean' },
    at: [[-38, 32], [-28, 22], [-45, 40], [-20, 40], [-14, 5], [-25, -20], [-15, 45], [-12, 38]],
    major: true,
  },
  { name: { pt: 'Oceano Atlântico Sul', en: 'South Atlantic' }, at: [[-15, -30], [-25, -35]], major: true },
  { name: { pt: 'Oceano Pacífico', en: 'Pacific Ocean' }, at: [[-140, 10], [-120, -15], [160, 20], [-95, 0], [-85, -15]], major: true },
  { name: { pt: 'Oceano Índico', en: 'Indian Ocean' }, at: [[75, -20], [65, -10]], major: true },
  { name: { pt: 'Mar Mediterrâneo', en: 'Mediterranean Sea' }, at: [[18, 34.5], [5, 38.5]], major: false },
  { name: { pt: 'Mar do Norte', en: 'North Sea' }, at: [[3, 56]], major: false },
  { name: { pt: 'Mar das Caraíbas', en: 'Caribbean Sea' }, at: [[-75, 15]], major: false },
  { name: { pt: 'Golfo do México', en: 'Gulf of Mexico' }, at: [[-90, 25]], major: false },
  { name: { pt: 'Baía da Biscaia', en: 'Bay of Biscay' }, at: [[-5, 45.3]], major: false },
];
