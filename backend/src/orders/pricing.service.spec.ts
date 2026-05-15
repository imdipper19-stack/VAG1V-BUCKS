import { Test, TestingModule } from '@nestjs/testing';
import { PricingService } from './pricing.service';

describe('PricingService', () => {
  let service: PricingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PricingService],
    }).compile();

    service = module.get<PricingService>(PricingService);
  });

  afterEach(() => {
    // Clean up env after each test
    delete process.env.PRICING_TRY_TO_RUB;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('constructor', () => {
    it('should use default exchange rate (1.63) when env not set', () => {
      delete process.env.PRICING_TRY_TO_RUB;
      const newService = new PricingService();
      expect(newService.getExchangeRate()).toBe(1.63);
    });

    it('should use custom exchange rate from env', () => {
      process.env.PRICING_TRY_TO_RUB = '1.75';
      const newService = new PricingService();
      expect(newService.getExchangeRate()).toBe(1.75);
    });

    it('should use default when env is invalid', () => {
      process.env.PRICING_TRY_TO_RUB = 'invalid';
      const newService = new PricingService();
      expect(newService.getExchangeRate()).toBe(1.63);
    });

    it('should use default when env is negative', () => {
      process.env.PRICING_TRY_TO_RUB = '-1.5';
      const newService = new PricingService();
      expect(newService.getExchangeRate()).toBe(1.63);
    });

    it('should use default when env is zero', () => {
      process.env.PRICING_TRY_TO_RUB = '0';
      const newService = new PricingService();
      expect(newService.getExchangeRate()).toBe(1.63);
    });
  });

  describe('listPublic', () => {
    it('should return public packages without wholesale prices', () => {
      const packages = service.listPublic();

      expect(packages).toHaveLength(4);
      expect(packages[0]).toHaveProperty('vbucksAmount');
      expect(packages[0]).toHaveProperty('priceRUB');
      expect(packages[0]).toHaveProperty('popular');
      expect(packages[0]).not.toHaveProperty('wholesaleTRY');
    });

    it('should return correct package data', () => {
      const packages = service.listPublic();
      const package800 = packages.find((p) => p.vbucksAmount === 800);

      expect(package800).toBeDefined();
      expect(package800?.priceRUB).toBe(499);
      expect(package800?.popular).toBe(false);
    });

    it('should mark 2400 package as popular', () => {
      const packages = service.listPublic();
      const package2400 = packages.find((p) => p.vbucksAmount === 2400);

      expect(package2400?.popular).toBe(true);
    });
  });

  describe('listWithProfit', () => {
    it('should return packages with profit calculations', () => {
      const packages = service.listWithProfit();

      expect(packages).toHaveLength(4);
      expect(packages[0]).toHaveProperty('costRUB');
      expect(packages[0]).toHaveProperty('profitRUB');
      expect(packages[0]).toHaveProperty('marginPercent');
    });

    it('should calculate costRUB correctly', () => {
      process.env.PRICING_TRY_TO_RUB = '1.63';
      const newService = new PricingService();
      const packages = newService.listWithProfit();
      const package800 = packages.find((p) => p.vbucksAmount === 800);

      expect(package800?.wholesaleTRY).toBe(120);
      expect(package800?.costRUB).toBeCloseTo(195.6, 1); // 120 * 1.63
    });

    it('should calculate profitRUB correctly', () => {
      process.env.PRICING_TRY_TO_RUB = '1.63';
      const newService = new PricingService();
      const packages = newService.listWithProfit();
      const package800 = packages.find((p) => p.vbucksAmount === 800);

      expect(package800?.priceRUB).toBe(499);
      expect(package800?.costRUB).toBeCloseTo(195.6, 1);
      expect(package800?.profitRUB).toBeCloseTo(303.4, 1); // 499 - 195.6
    });

    it('should calculate marginPercent correctly', () => {
      process.env.PRICING_TRY_TO_RUB = '1.63';
      const newService = new PricingService();
      const packages = newService.listWithProfit();
      const package800 = packages.find((p) => p.vbucksAmount === 800);

      expect(package800?.profitRUB).toBeCloseTo(303.4, 1);
      expect(package800?.priceRUB).toBe(499);
      expect(package800?.marginPercent).toBeGreaterThan(60);
    });
  });

  describe('findByAmount', () => {
    it('should find package by amount', () => {
      const pkg = service.findByAmount(2400);

      expect(pkg).toBeDefined();
      expect(pkg?.vbucksAmount).toBe(2400);
      expect(pkg?.priceRUB).toBe(1399);
    });

    it('should return null for non-existent amount', () => {
      const pkg = service.findByAmount(999);
      expect(pkg).toBeNull();
    });

    it('should return null for negative amount', () => {
      const pkg = service.findByAmount(-100);
      expect(pkg).toBeNull();
    });

    it('should return null for zero', () => {
      const pkg = service.findByAmount(0);
      expect(pkg).toBeNull();
    });
  });

  describe('withProfit', () => {
    it('should calculate profit for a package', () => {
      process.env.PRICING_TRY_TO_RUB = '1.63';
      const newService = new PricingService();
      const pkg = {
        vbucksAmount: 2400,
        priceRUB: 1399,
        wholesaleTRY: 350,
        popular: true,
      };

      const result = newService.withProfit(pkg);

      expect(result.costRUB).toBeCloseTo(570.5, 2); // 350 * 1.63
      expect(result.profitRUB).toBeCloseTo(828.5, 2); // 1399 - 570.5
      expect(result.marginPercent).toBeCloseTo(59.2, 1); // (828.5 / 1399) * 100
    });

    it('should handle zero priceRUB', () => {
      process.env.PRICING_TRY_TO_RUB = '1.63';
      const newService = new PricingService();
      const pkg = {
        vbucksAmount: 2400,
        priceRUB: 0,
        wholesaleTRY: 350,
        popular: true,
      };

      const result = newService.withProfit(pkg);

      expect(result.costRUB).toBeCloseTo(570.5, 2);
      expect(result.profitRUB).toBeCloseTo(-570.5, 2);
      expect(result.marginPercent).toBe(0);
    });
  });

  describe('getExchangeRate', () => {
    it('should return current exchange rate', () => {
      process.env.PRICING_TRY_TO_RUB = '2.0';
      const newService = new PricingService();
      expect(newService.getExchangeRate()).toBe(2.0);
    });
  });
});
