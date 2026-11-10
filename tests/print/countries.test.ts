import { geoArea } from 'd3-geo';
import type { Polygon } from 'geojson';
import { describe, expect, it } from 'vitest';
import { CountryLocator, countryFromName, countryName, repairWinding } from '../../src/print/countries';
import { flagSymbol } from '../../src/print/svg';
import { topology } from './fixtures';

const locator = new CountryLocator(topology);

describe('countries', () => {
  it('finds the country of a place from the map', () => {
    expect(locator.locate({ lat: 41.5454, lon: -8.4265 })).toBe('pt'); // Braga
    expect(locator.locate({ lat: -23.55, lon: -46.63 })).toBe('br');
    expect(locator.locate({ lat: 42.36, lon: -71.06 })).toBe('us');
    expect(locator.locate({ lat: -8.84, lon: 13.29 })).toBe('ao');
    expect(locator.locate({ lat: 32.6669, lon: -16.9241 })).toBe('pt'); // Funchal, Madeira
  });

  it('looks around coastal towns that fall just off the simplified coast', () => {
    expect(locator.codeAt(-9.42, 38.7)).toBe(''); // Cascais, just off the 1:50m coastline
    expect(locator.locate({ lat: 38.7, lon: -9.42 })).toBe('pt');
  });

  it('falls back on the place name out at sea', () => {
    expect(locator.locate({ lat: 30, lon: -40, place: 'Somewhere, Portugal' })).toBe('pt');
    expect(locator.locate({ lat: 30, lon: -40 })).toBe('');
    expect(countryFromName('Boston, Massachusetts, USA')).toBe('us');
    expect(countryFromName('London, England')).toBe('gb');
    expect(countryFromName('Recife, Brasil')).toBe('br');
    expect(countryFromName('Nowhere')).toBe('');
  });

  it('names countries in Portuguese and English', () => {
    expect(countryName('br', 'pt')).toBe('Brasil');
    expect(countryName('us', 'pt')).toBe('Estados Unidos');
    expect(countryName('us', 'en')).toBe('United States');
    expect(countryName('de', 'pt')).toBe('Alemanha');
  });

  it('places country names on the largest piece of the country', () => {
    const [lon, lat] = locator.labelPoint('pt')!;
    expect(lon).toBeGreaterThan(-9.5);
    expect(lon).toBeLessThan(-6.5); // mainland, not Madeira or the Azores
    expect(lat).toBeGreaterThan(37);
  });

  it('turns wrongly wound polygons the right way round', () => {
    const tiny: Polygon = { type: 'Polygon', coordinates: [[[0, 0], [0, 1], [1, 1], [0, 0]]] };
    const reversed: Polygon = { type: 'Polygon', coordinates: [[...tiny.coordinates[0]].reverse()] };
    const big = geoArea(tiny) > 2 * Math.PI ? tiny : reversed;
    expect(geoArea(big)).toBeGreaterThan(2 * Math.PI);
    expect(geoArea(repairWinding(big))).toBeLessThan(0.01);
    const ok = big === tiny ? reversed : tiny;
    expect(repairWinding(ok).coordinates).toEqual(ok.coordinates);
  });
});

describe('flagSymbol', () => {
  it('turns a flag-icons file into a reusable symbol, keeping root fills', () => {
    const sym = flagSymbol('xx', '<svg xmlns="http://www.w3.org/2000/svg" fill="#ffd900" id="flag-icons-xx" viewBox="0 0 512 512"><path d="M0 0h512v512H0z"/></svg>');
    expect(sym).toBe('<symbol id="flag-xx" viewBox="0 0 512 512" preserveAspectRatio="xMidYMid slice"><g fill="#ffd900"><path d="M0 0h512v512H0z"/></g></symbol>');
    expect(flagSymbol('xx', 'not svg')).toBe('');
  });
});
