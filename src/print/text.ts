// Words printed on the map, in Portuguese, English and Spanish.

import type { Lang } from './types';

export const STRINGS = {
  pt: {
    legend: 'Legenda',
    generationOf: (years: string) => `Geração de ${years}`,
    generation: (r: string) => `${r}.ª geração`,
    birthplace: 'Local de nascimento',
    origin: 'País de origem',
    scale: 'Escala de quilômetros',
    scaleEquator: 'Escala de quilômetros, no equador',
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
  es: {
    legend: 'Leyenda',
    generationOf: (years: string) => `Generación de ${years}`,
    generation: (r: string) => `Generación ${r}`,
    birthplace: 'Lugar de nacimiento',
    origin: 'País de origen',
    scale: 'Escala en kilómetros',
    scaleEquator: 'Escala en kilómetros, en el ecuador',
    family: (surname: string) => `Familia ${surname}`,
  },
} satisfies Record<Lang, unknown>;

/** Oceans and seas, with spots to write their names (tried in order until one fits). */
export const WATERS: { name: Record<Lang, string>; at: [number, number][]; major: boolean }[] = [
  {
    name: { pt: 'Oceano Atlântico', en: 'Atlantic Ocean', es: 'Océano Atlántico' },
    at: [[-38, 32], [-28, 22], [-45, 40], [-50, 28], [-55, 35], [-40, 45], [-60, 22], [-35, 15], [-20, 40], [-14, 5], [-25, -20], [-15, 45], [-12, 38]],
    major: true,
  },
  { name: { pt: 'Oceano Atlântico Sul', en: 'South Atlantic', es: 'Atlántico Sur' }, at: [[-15, -30], [-25, -35]], major: true },
  { name: { pt: 'Oceano Pacífico', en: 'Pacific Ocean', es: 'Océano Pacífico' }, at: [[-140, 10], [-120, -15], [160, 20], [-95, 0], [-100, -12], [-110, 8], [-85, -15]], major: true },
  { name: { pt: 'Oceano Índico', en: 'Indian Ocean', es: 'Océano Índico' }, at: [[75, -20], [65, -10]], major: true },
  { name: { pt: 'Mar Mediterrâneo', en: 'Mediterranean Sea', es: 'Mar Mediterráneo' }, at: [[18, 34.5], [5, 38.5]], major: false },
  { name: { pt: 'Mar do Norte', en: 'North Sea', es: 'Mar del Norte' }, at: [[3, 56]], major: false },
  { name: { pt: 'Mar do Caribe', en: 'Caribbean Sea', es: 'Mar Caribe' }, at: [[-75, 15]], major: false },
  { name: { pt: 'Golfo do México', en: 'Gulf of Mexico', es: 'Golfo de México' }, at: [[-90, 25]], major: false },
  { name: { pt: 'Baía da Biscaia', en: 'Bay of Biscay', es: 'Golfo de Vizcaya' }, at: [[-5, 45.3]], major: false },
];
