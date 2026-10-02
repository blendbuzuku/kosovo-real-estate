import { criteriaFromParams, criteriaToParams, describeCriteria } from './criteria';
import { formatPrice, shortPrice } from './labels';

describe('search criteria in the URL', () => {
  it('round-trips through query params with the right types', () => {
    const c = criteriaFromParams({ city: 'Prishtinë', maxPrice: '120000', legalizedOnly: 'true', hasParking: 'false' });
    expect(c).toEqual({ city: 'Prishtinë', maxPrice: 120000, legalizedOnly: true });
    expect(criteriaToParams(c)).toEqual({ city: 'Prishtinë', maxPrice: 120000, legalizedOnly: true });
  });

  it('ignores junk numbers', () => {
    expect(criteriaFromParams({ minRooms: 'abc' })).toEqual({});
  });

  it('describes a search for the default saved-search name', () => {
    expect(describeCriteria({ propertyType: 'Apartment', dealType: 'Sale', city: 'Prizren', maxPrice: 90000 })).toBe(
      'Apartments for sale in Prizren under 90.000 €',
    );
  });
});

describe('price formatting', () => {
  it('adds the rent period', () => {
    expect(formatPrice(450, 'RentMonthly')).toContain('/ month');
    expect(formatPrice(85000, 'Sale')).not.toContain('/');
  });

  it('shortens prices for map pins', () => {
    expect(shortPrice(85000)).toBe('85k €');
    expect(shortPrice(1250000)).toBe('1.3M €');
    expect(shortPrice(450)).toBe('450 €');
  });
});
