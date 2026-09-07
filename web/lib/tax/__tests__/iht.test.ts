import { describe, it, expect } from 'vitest';
import { computeEstate, taperReduction, type Gift } from '../iht';

const DEATH = new Date(Date.UTC(2026, 8, 1)); // 1 September 2026

function yearsBefore(n: number): Date {
  return new Date(DEATH.getTime() - n * 365.25 * 24 * 60 * 60 * 1000);
}

describe('taper relief bands', () => {
  it('gives no reduction inside 3 years and full exemption at 7', () => {
    expect(taperReduction(2)).toBe(0);
    expect(taperReduction(3.5)).toBe(0.2);
    expect(taperReduction(4.5)).toBe(0.4);
    expect(taperReduction(5.5)).toBe(0.6);
    expect(taperReduction(6.5)).toBe(0.8);
    expect(taperReduction(7.5)).toBe(1);
  });
});

describe('THE TAPER RELIEF TRAP', () => {
  it('a £300,000 gift 5 years before death gets NO taper benefit at all', () => {
    // It sits inside the NRB, so no tax arises on the gift to taper.
    // The naive implementation would compute 40% × 300,000 × (1 − 0.6) = £48,000.
    // The correct answer is nil.
    const gifts: Gift[] = [
      { id: 'g1', date: yearsBefore(5), value: 300_000, classification: 'PET' },
    ];
    const r = computeEstate({
      dateOfDeath: DEATH,
      estateValue: 500_000,
      residenceToDirectDescendants: false,
      gifts,
    });

    expect(r.failedPets).toHaveLength(1);
    const pet = r.failedPets[0]!;
    expect(pet.coveredByNrb).toBe(300_000);
    expect(pet.chargeableAboveNrb).toBe(0);
    expect(pet.taxPayable).toBe(0);
    expect(r.giftsTax).toBe(0);
    expect(pet.explanation).toContain('TAPER RELIEF GIVES NOTHING');
  });

  it('but the gift still absorbs nil-rate band and raises tax on the estate', () => {
    const withGift = computeEstate({
      dateOfDeath: DEATH,
      estateValue: 500_000,
      residenceToDirectDescendants: false,
      gifts: [{ id: 'g1', date: yearsBefore(5), value: 300_000, classification: 'PET' }],
    });
    const withoutGift = computeEstate({
      dateOfDeath: DEATH,
      estateValue: 500_000,
      residenceToDirectDescendants: false,
      gifts: [],
    });

    // NRB to estate: 325,000 − 300,000 = 25,000 vs the full 325,000
    expect(withGift.nilRateBandAvailableToEstate).toBe(25_000);
    expect(withoutGift.nilRateBandAvailableToEstate).toBe(325_000);
    // Estate tax rises by 40% of the 300,000 of band consumed
    expect(withGift.estateTax - withoutGift.estateTax).toBe(120_000);
  });

  it('taper DOES apply to the slice of a gift above the available NRB', () => {
    // £525,000 gift 5 years before death: £325,000 covered by NRB,
    // £200,000 bears tax at 40% = £80,000, tapered by 60% = £32,000 payable.
    const r = computeEstate({
      dateOfDeath: DEATH,
      estateValue: 400_000,
      residenceToDirectDescendants: false,
      gifts: [{ id: 'g1', date: yearsBefore(5), value: 525_000, classification: 'PET' }],
    });
    const pet = r.failedPets[0]!;
    expect(pet.coveredByNrb).toBe(325_000);
    expect(pet.chargeableAboveNrb).toBe(200_000);
    expect(pet.taxBeforeTaper).toBe(80_000);
    expect(pet.taperReductionRate).toBe(0.6);
    expect(pet.taxPayable).toBe(32_000);
  });

  it('cumulates earlier gifts so a later gift has less NRB available', () => {
    const gifts: Gift[] = [
      { id: 'g1', date: yearsBefore(6), value: 200_000, classification: 'PET' },
      { id: 'g2', date: yearsBefore(2), value: 200_000, classification: 'PET' },
    ];
    const r = computeEstate({
      dateOfDeath: DEATH,
      estateValue: 300_000,
      residenceToDirectDescendants: false,
      gifts,
    });
    const [first, second] = r.failedPets;
    expect(first!.nilRateBandAvailable).toBe(325_000);
    expect(first!.chargeableAboveNrb).toBe(0);
    // Second gift only has 125,000 of NRB left
    expect(second!.nilRateBandAvailable).toBe(125_000);
    expect(second!.chargeableAboveNrb).toBe(75_000);
    // Within 3 years, so no taper: 75,000 × 40% = 30,000
    expect(second!.taperReductionRate).toBe(0);
    expect(second!.taxPayable).toBe(30_000);
  });

  it('ignores gifts more than 7 years before death', () => {
    const r = computeEstate({
      dateOfDeath: DEATH,
      estateValue: 500_000,
      residenceToDirectDescendants: false,
      gifts: [{ id: 'g1', date: yearsBefore(8), value: 400_000, classification: 'PET' }],
    });
    expect(r.failedPets).toHaveLength(0);
    expect(r.nilRateBandAvailableToEstate).toBe(325_000);
  });

  it('excludes exempt gifts from cumulation', () => {
    const r = computeEstate({
      dateOfDeath: DEATH,
      estateValue: 500_000,
      residenceToDirectDescendants: false,
      gifts: [
        { id: 'g1', date: yearsBefore(2), value: 3_000, classification: 'exempt_annual' },
        { id: 'g2', date: yearsBefore(1), value: 50_000, classification: 'exempt_spouse' },
      ],
    });
    expect(r.failedPets).toHaveLength(0);
    expect(r.cumulativeChargeableTransfers).toBe(0);
  });

  it('treats a gift with reservation of benefit as achieving nothing', () => {
    const r = computeEstate({
      dateOfDeath: DEATH,
      estateValue: 500_000,
      residenceToDirectDescendants: false,
      gifts: [
        {
          id: 'g1',
          date: yearsBefore(5),
          value: 300_000,
          classification: 'PET',
          reservationOfBenefit: true,
        },
      ],
    });
    // Not treated as a chargeable transfer here — it stays in the estate instead
    expect(r.failedPets).toHaveLength(0);
  });
});

describe('residence nil-rate band', () => {
  it('is available in full below the £2m taper threshold', () => {
    const r = computeEstate({
      dateOfDeath: DEATH,
      estateValue: 1_500_000,
      residenceToDirectDescendants: true,
      residenceValue: 600_000,
      gifts: [],
    });
    expect(r.rnrbAvailable).toBe(175_000);
    expect(r.rnrbTapered).toBe(0);
  });

  it('tapers £1 for every £2 above £2m', () => {
    const r = computeEstate({
      dateOfDeath: DEATH,
      estateValue: 2_200_000,
      residenceToDirectDescendants: true,
      residenceValue: 600_000,
      gifts: [],
    });
    // 200,000 excess ÷ 2 = 100,000 reduction
    expect(r.rnrbTapered).toBe(100_000);
    expect(r.rnrbAvailable).toBe(75_000);
  });

  it('is extinguished entirely at £2.35m', () => {
    const r = computeEstate({
      dateOfDeath: DEATH,
      estateValue: 2_350_000,
      residenceToDirectDescendants: true,
      residenceValue: 600_000,
      gifts: [],
    });
    expect(r.rnrbAvailable).toBe(0);
  });

  it('THE BUSINESS ASSET INTERACTION: relieved business assets still taper the RNRB', () => {
    // £1.2m estate plus £1.5m of fully-relieved business assets. The business
    // pays no IHT, but it pushes the estate over £2m and destroys the RNRB.
    const r = computeEstate({
      dateOfDeath: DEATH,
      estateValue: 2_700_000,
      businessAssetsUnrelievedValue: 1_500_000,
      businessReliefGiven: 1_500_000,
      residenceToDirectDescendants: true,
      residenceValue: 600_000,
      gifts: [],
    });
    expect(r.rnrbAvailable).toBe(0);
    expect(r.workings.join(' ')).toContain('UNRELIEVED value');
  });

  it('gives nothing where no residence passes to lineal descendants', () => {
    const r = computeEstate({
      dateOfDeath: DEATH,
      estateValue: 1_000_000,
      residenceToDirectDescendants: false,
      gifts: [],
    });
    expect(r.rnrbAvailable).toBe(0);
  });
});

describe('transferable bands and exemptions', () => {
  it('adds a transferred nil-rate band', () => {
    const r = computeEstate({
      dateOfDeath: DEATH,
      estateValue: 1_000_000,
      residenceToDirectDescendants: true,
      residenceValue: 400_000,
      transferredNrbPercentage: 1,
      transferredRnrbPercentage: 1,
      gifts: [],
    });
    expect(r.nilRateBandAvailableToEstate).toBe(650_000);
    expect(r.rnrbAvailable).toBe(350_000);
    // £1m estate fully covered by £1m of bands
    expect(r.estateTax).toBe(0);
  });

  it('applies the 36% reduced rate where 10%+ passes to charity', () => {
    const r = computeEstate({
      dateOfDeath: DEATH,
      estateValue: 1_000_000,
      charityAmount: 70_000,
      residenceToDirectDescendants: false,
      gifts: [],
    });
    // Baseline = 1,000,000 − 70,000 − 325,000 = 605,000; 10% = 60,500. 70,000 clears it.
    expect(r.rateApplied).toBe(0.36);
  });

  it('treats spouse gifts as wholly exempt', () => {
    const r = computeEstate({
      dateOfDeath: DEATH,
      estateValue: 2_000_000,
      spouseExemptAmount: 2_000_000,
      residenceToDirectDescendants: false,
      gifts: [],
    });
    expect(r.estateTax).toBe(0);
  });
});
