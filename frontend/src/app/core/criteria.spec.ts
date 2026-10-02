import { activeFilterCount, criteriaFromParams, criteriaToParams, withFilter } from './criteria';
import { fold, formatField } from './catalog';
import { formatPrice, shortPrice } from './labels';
import { FieldDef } from './models';

describe('search criteria in the URL', () => {
  it('round-trips with typed numbers and field filters', () => {
    const c = criteriaFromParams({ municipality: 'Prishtinë', maxPrice: '120000', 'f.rooms.min': '3', 'f.fuel': 'Diesel,Hybrid' });
    expect(c).toEqual({ municipality: 'Prishtinë', maxPrice: 120000, f: { 'rooms.min': '3', fuel: 'Diesel,Hybrid' } });
    expect(criteriaToParams(c)).toEqual({
      municipality: 'Prishtinë',
      maxPrice: 120000,
      'f.rooms.min': '3',
      'f.fuel': 'Diesel,Hybrid',
    });
  });

  it('ignores junk numbers', () => {
    expect(criteriaFromParams({ minPrice: 'abc' })).toEqual({});
  });

  it('sets and clears single field filters', () => {
    const c = withFilter({ category: 'cars' }, 'mileageKm.max', '150000');
    expect(c.f).toEqual({ 'mileageKm.max': '150000' });
    expect(withFilter(c, 'mileageKm.max', null).f).toBeNull();
    expect(activeFilterCount({ ...c, municipality: 'Pejë' })).toBe(2);
  });
});

describe('formatting', () => {
  it('adds the rent period', () => {
    expect(formatPrice(450, 'RentMonthly')).toContain('/ month');
    expect(formatPrice(45, 'RentNightly')).toContain('/ night');
    expect(formatPrice(25, 'RentDaily')).toContain('/ day');
    expect(formatPrice(85000, 'Sale')).not.toContain('/');
  });

  it('shortens prices for map pins', () => {
    expect(shortPrice(85000)).toBe('85k €');
    expect(shortPrice(1250000)).toBe('1.3M €');
    expect(shortPrice(450)).toBe('450 €');
  });

  it('formats field values for cards', () => {
    const rooms: FieldDef = { key: 'rooms', label: 'Rooms', type: 'Integer', required: false, filter: 'Min', onCard: true, group: 'Details' };
    const area: FieldDef = { ...rooms, key: 'areaM2', label: 'Living area', type: 'Number', unit: 'm²' };
    const floor: FieldDef = { ...rooms, key: 'floor', label: 'Floor' };
    expect(formatField(rooms, 3, true)).toBe('3 rooms');
    expect(formatField(rooms, 1, true)).toBe('1 room');
    expect(formatField(area, 72.5, true)).toBe('72,5 m²');
    expect(formatField(floor, 0, true)).toBe('Ground floor');
  });

  it('drops unknown sort, deal and seller values from the URL', () => {
    const c = criteriaFromParams({ sort: 'Nope', dealType: 'Swap', seller: 'Robots', vertical: 'boats', category: 'cars' });
    expect(c).toEqual({ category: 'cars' });
    expect(criteriaFromParams({ sort: 'PriceAsc' }).sort).toBe('PriceAsc');
  });

  it('folds Albanian letters for location search', () => {
    expect(fold('Fushë Kosovë')).toBe('fushe kosove');
    expect(fold('Çagllavicë')).toBe('cagllavice');
  });
});
