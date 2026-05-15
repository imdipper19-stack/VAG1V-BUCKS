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

const BASE_PACKAGES: VBucksPackage[] = [
  { vbucksAmount: 800,   priceRUB: 499,  wholesaleTRY: 120,  popular: false },
  { vbucksAmount: 2400,  priceRUB: 1399, wholesaleTRY: 350,  popular: true  },
  { vbucksAmount: 4500,  priceRUB: 2499, wholesaleTRY: 640,  popular: false },
  { vbucksAmount: 12500, priceRUB: 6499, wholesaleTRY: 1650, popular: false },
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
