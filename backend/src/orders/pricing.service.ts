import { Injectable } from '@nestjs/common';

/**
 * Единый источник правды по пакетам V-Bucks.
 * Цены продажи — в рублях, себестоимость — в TRY (закупка через Razer Gold).
 * Курс TRY→RUB задаётся через env (PRICING_TRY_TO_RUB), дефолт 1.63.
 */
export interface VBucksPackage {
  vbucksAmount: number;
  priceRUB: number;
  wholesaleTRY: number;
  popular: boolean;
}

export interface VBucksPackageWithProfit extends VBucksPackage {
  costRUB: number;
  profitRUB: number;
  marginPercent: number;
}

/**
 * Базовые пакеты V-Bucks. Offer ID берутся в EpicApiPurchaseService из VBUCKS_OFFERS —
 * номиналы здесь должны точно совпадать с ключами там. Расхождение = `package_not_found`.
 *
 * В Fortnite Store есть ровно 4 базовых постоянных пакета: 800 / 2400 / 4500 / 12500.
 *
 * priceRUB — продажа покупателю. Цены подобраны исходя из реальных Razer Gold TRY:
 *   800   = 190 TRY   ≈ 310 RUB себестоимость → 499 RUB продажа (≈38% маржа)
 *   2400  = 485 TRY   ≈ 791 RUB себестоимость → 1199 RUB продажа (≈34% маржа)
 *   4500  = 780 TRY   ≈ 1271 RUB себестоимость → 1899 RUB продажа (≈33% маржа)
 *   12500 = 1898 TRY  ≈ 3094 RUB себестоимость → 4499 RUB продажа (≈31% маржа)
 *
 * wholesaleTRY — закупочная цена в Razer Gold. Маржа в RUB считается через PRICING_TRY_TO_RUB.
 */
const BASE_PACKAGES: VBucksPackage[] = [
  { vbucksAmount: 800,   priceRUB: 499,  wholesaleTRY: 190,  popular: false },
  { vbucksAmount: 2400,  priceRUB: 1199, wholesaleTRY: 485,  popular: true  },
  { vbucksAmount: 4500,  priceRUB: 1899, wholesaleTRY: 780,  popular: false },
  { vbucksAmount: 12500, priceRUB: 4499, wholesaleTRY: 1898, popular: false },
];

@Injectable()
export class PricingService {
  private readonly tryToRub: number;

  constructor() {
    const raw = process.env.PRICING_TRY_TO_RUB;
    const parsed = raw ? Number.parseFloat(raw) : NaN;
    this.tryToRub = Number.isFinite(parsed) && parsed > 0 ? parsed : 1.63;
  }

  /** Публичный список пакетов — без себестоимости, для лендинга/страницы покупателя. */
  listPublic(): Array<Omit<VBucksPackage, 'wholesaleTRY'>> {
    return BASE_PACKAGES.map(({ vbucksAmount, priceRUB, popular }) => ({
      vbucksAmount,
      priceRUB,
      popular,
    }));
  }

  /** Полный список с прибылью — только для админки (защищается AdminAuthGuard). */
  listWithProfit(): VBucksPackageWithProfit[] {
    return BASE_PACKAGES.map((p) => this.withProfit(p));
  }

  /** Найти пакет по количеству V-Bucks. */
  findByAmount(vbucksAmount: number): VBucksPackage | null {
    return BASE_PACKAGES.find((p) => p.vbucksAmount === vbucksAmount) ?? null;
  }

  /** Расчёт прибыли по одному пакету. */
  withProfit(pkg: VBucksPackage): VBucksPackageWithProfit {
    const costRUB = Number((pkg.wholesaleTRY * this.tryToRub).toFixed(2));
    const profitRUB = Number((pkg.priceRUB - costRUB).toFixed(2));
    const marginPercent = pkg.priceRUB > 0
      ? Number(((profitRUB / pkg.priceRUB) * 100).toFixed(1))
      : 0;

    return { ...pkg, costRUB, profitRUB, marginPercent };
  }

  /** Текущий курс TRY → RUB (читается из env). */
  getExchangeRate(): number {
    return this.tryToRub;
  }
}
