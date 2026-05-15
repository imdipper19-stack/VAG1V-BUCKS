import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { AdminAuthService, LoginResult, TokenPayload } from './admin-auth.service';
import { Admin, AdminRole } from './admin.entity';

describe('AdminAuthService', () => {
  let service: AdminAuthService;
  let adminRepository: Repository<Admin>;
  let configService: ConfigService;

  const mockAdmin: Partial<Admin> = {
    id: 'admin-1',
    username: 'testadmin',
    email: 'admin@test.com',
    passwordHash: 'salt:hash', // Will be set in tests
    role: AdminRole.ADMIN,
    isActive: true,
    failedLoginAttempts: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockConfigService = {
    get: jest.fn((key: string, defaultValue?: any) => defaultValue),
  };

  const mockRepository = {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminAuthService,
        {
          provide: getRepositoryToken(Admin),
          useValue: mockRepository,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<AdminAuthService>(AdminAuthService);
    adminRepository = module.get<Repository<Admin>>(getRepositoryToken(Admin));
    configService = module.get<ConfigService>(ConfigService);

    jest.clearAllMocks();
    mockConfigService.get.mockReturnValue('test-secret');
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('hashPassword', () => {
    it('should hash password with salt', () => {
      const password = 'test-password';
      const hash = service['hashPassword'](password);

      expect(hash).toContain(':');
      const [salt, hashPart] = hash.split(':');
      expect(salt).toHaveLength(32); // 16 bytes = 32 hex chars
      expect(hashPart).toHaveLength(128); // 64 bytes = 128 hex chars
    });

    it('should generate different hashes for same password', () => {
      const password = 'test-password';
      const hash1 = service['hashPassword'](password);
      const hash2 = service['hashPassword'](password);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('verifyPassword', () => {
    it('should verify correct password with new format', () => {
      const password = 'test-password';
      const hash = service['hashPassword'](password);

      const result = service['verifyPassword'](password, hash);
      expect(result).toBe(true);
    });

    it('should reject incorrect password with new format', () => {
      const password = 'test-password';
      const hash = service['hashPassword'](password);

      const result = service['verifyPassword']('wrong-password', hash);
      expect(result).toBe(false);
    });

    it('should verify legacy SHA-256 hash', () => {
      const password = 'test-password';
      const crypto = require('crypto');
      const legacyHash = crypto.createHash('sha256').update(password).digest('hex');

      const result = service['verifyPassword'](password, legacyHash);
      expect(result).toBe(true);
    });

    it('should reject incorrect legacy hash', () => {
      const legacyHash = 'a1b2c3d4e5f6';

      const result = service['verifyPassword']('wrong-password', legacyHash);
      expect(result).toBe(false);
    });
  });

  describe('generateToken', () => {
    it('should generate valid JWT token', () => {
      const token = service['generateToken'](mockAdmin as Admin);

      expect(token).toBeDefined();
      expect(token.split('.')).toHaveLength(3); // header.payload.signature
    });

    it('should include correct payload in token', () => {
      const token = service['generateToken'](mockAdmin as Admin);
      const payload = service['verifyToken'](token);

      expect(payload).toBeDefined();
      expect(payload?.sub).toBe(mockAdmin.id);
      expect(payload?.username).toBe(mockAdmin.username);
      expect(payload?.role).toBe(mockAdmin.role);
      expect(payload?.iat).toBeDefined();
      expect(payload?.exp).toBeDefined();
    });

    it('should set expiration time correctly', () => {
      const token = service['generateToken'](mockAdmin as Admin);
      const payload = service['verifyToken'](token);

      const now = Math.floor(Date.now() / 1000);
      expect(payload?.exp).toBeGreaterThan(now);
      expect(payload?.exp).toBeLessThanOrEqual(now + 86401); // 24h + 1s margin
    });
  });

  describe('verifyToken', () => {
    it('should verify valid token', () => {
      const token = service['generateToken'](mockAdmin as Admin);
      const payload = service.verifyToken(token);

      expect(payload).toBeDefined();
      expect(payload?.sub).toBe(mockAdmin.id);
    });

    it('should reject invalid token format', () => {
      const payload = service.verifyToken('invalid-token');
      expect(payload).toBeNull();
    });

    it('should reject token with wrong signature', () => {
      const token = service['generateToken'](mockAdmin as Admin);
      const parts = token.split('.');
      const tamperedToken = `${parts[0]}.${parts[1]}.wrongsignature`;

      const payload = service.verifyToken(tamperedToken);
      expect(payload).toBeNull();
    });

    it('should reject expired token', () => {
      const token = service['generateToken'](mockAdmin as Admin);
      const parts = token.split('.');
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
      payload.exp = Math.floor(Date.now() / 1000) - 3600; // Expired 1 hour ago
      const tamperedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
      const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

      const result = service.verifyToken(tamperedToken);
      expect(result).toBeNull();
    });

    it('should reject token with future iat', () => {
      const token = service['generateToken'](mockAdmin as Admin);
      const parts = token.split('.');
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
      payload.iat = Math.floor(Date.now() / 1000) + 1000; // Future timestamp
      const tamperedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
      const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

      const result = service.verifyToken(tamperedToken);
      expect(result).toBeNull();
    });
  });

  describe('parseExpiresIn', () => {
    it('should parse seconds', () => {
      const result = service['parseExpiresIn']('30s');
      expect(result).toBe(30000);
    });

    it('should parse minutes', () => {
      const result = service['parseExpiresIn']('30m');
      expect(result).toBe(30 * 60 * 1000);
    });

    it('should parse hours', () => {
      const result = service['parseExpiresIn']('24h');
      expect(result).toBe(24 * 60 * 60 * 1000);
    });

    it('should parse days', () => {
      const result = service['parseExpiresIn']('7d');
      expect(result).toBe(7 * 24 * 60 * 60 * 1000);
    });

    it('should return default for invalid format', () => {
      const result = service['parseExpiresIn']('invalid');
      expect(result).toBe(24 * 60 * 60 * 1000);
    });
  });

  describe('login', () => {
    it('should login successfully with valid credentials', async () => {
      const password = 'test-password';
      const hash = service['hashPassword'](password);
      const admin = { ...mockAdmin, passwordHash: hash };

      mockRepository.findOne.mockResolvedValue(admin);
      mockRepository.update.mockResolvedValue({});

      const result = await service.login('testadmin', password, '127.0.0.1');

      expect(result.success).toBe(true);
      expect(result.token).toBeDefined();
      expect(result.admin).toBeDefined();
      expect(result.admin?.username).toBe('testadmin');
    });

    it('should fail with non-existent user', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      const result = await service.login('nonexistent', 'password', '127.0.0.1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid credentials');
      expect(result.token).toBeUndefined();
    });

    it('should fail with inactive account', async () => {
      const admin = { ...mockAdmin, isActive: false };
      mockRepository.findOne.mockResolvedValue(admin);

      const result = await service.login('testadmin', 'password', '127.0.0.1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Account is disabled');
    });

    it('should fail with locked account', async () => {
      const lockedUntil = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes from now
      const admin = { ...mockAdmin, lockedUntil };
      mockRepository.findOne.mockResolvedValue(admin);

      const result = await service.login('testadmin', 'password', '127.0.0.1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Account locked');
    });

    it('should fail with wrong password', async () => {
      const password = 'test-password';
      const hash = service['hashPassword'](password);
      const admin = { ...mockAdmin, passwordHash: hash };

      mockRepository.findOne.mockResolvedValue(admin);
      mockRepository.save.mockResolvedValue({});

      const result = await service.login('testadmin', 'wrong-password', '127.0.0.1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid credentials');
    });

    it('should increment failed login attempts on wrong password', async () => {
      const password = 'test-password';
      const hash = service['hashPassword'](password);
      const admin = { ...mockAdmin, passwordHash: hash, failedLoginAttempts: 2 };

      mockRepository.findOne.mockResolvedValue(admin);
      mockRepository.save.mockResolvedValue({});

      await service.login('testadmin', 'wrong-password', '127.0.0.1');

      expect(mockRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          failedLoginAttempts: 3,
        }),
      );
    });

    it('should lock account after 5 failed attempts', async () => {
      const password = 'test-password';
      const hash = service['hashPassword'](password);
      const admin = { ...mockAdmin, passwordHash: hash, failedLoginAttempts: 5 };

      mockRepository.findOne.mockResolvedValue(admin);
      mockRepository.save.mockResolvedValue({});

      await service.login('testadmin', 'wrong-password', '127.0.0.1');

      expect(mockRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          failedLoginAttempts: 6,
          lockedUntil: expect.any(Date),
        }),
      );
    });

    it('should reset failed attempts on successful login', async () => {
      const password = 'test-password';
      const hash = service['hashPassword'](password);
      const admin = { ...mockAdmin, passwordHash: hash, failedLoginAttempts: 3 };

      mockRepository.findOne.mockResolvedValue(admin);
      mockRepository.update.mockResolvedValue({});

      await service.login('testadmin', password, '127.0.0.1');

      expect(mockRepository.update).toHaveBeenCalledWith(
        admin.id,
        expect.objectContaining({
          failedLoginAttempts: 0,
          lockedUntil: null,
        }),
      );
    });

    it('should update lastLoginAt and lastLoginIp on successful login', async () => {
      const password = 'test-password';
      const hash = service['hashPassword'](password);
      const admin = { ...mockAdmin, passwordHash: hash };

      mockRepository.findOne.mockResolvedValue(admin);
      mockRepository.update.mockResolvedValue({});

      await service.login('testadmin', password, '192.168.1.1');

      expect(mockRepository.update).toHaveBeenCalledWith(
        admin.id,
        expect.objectContaining({
          lastLoginAt: expect.any(Date),
          lastLoginIp: '192.168.1.1',
        }),
      );
    });

    it('should migrate legacy SHA-256 hash to scrypt on successful login', async () => {
      const password = 'test-password';
      const crypto = require('crypto');
      const legacyHash = crypto.createHash('sha256').update(password).digest('hex');
      const admin = { ...mockAdmin, passwordHash: legacyHash };

      mockRepository.findOne.mockResolvedValue(admin);
      mockRepository.update.mockResolvedValue({});

      await service.login('testadmin', password, '127.0.0.1');

      expect(mockRepository.update).toHaveBeenCalledWith(
        admin.id,
        expect.objectContaining({
          passwordHash: expect.stringContaining(':'), // New format has salt
        }),
      );
    });
  });

  describe('validateToken', () => {
    it('should return admin for valid token', async () => {
      const token = service['generateToken'](mockAdmin as Admin);
      mockRepository.findOne.mockResolvedValue(mockAdmin);

      const result = await service.validateToken(token);

      expect(result).toBeDefined();
      expect(result?.id).toBe(mockAdmin.id);
    });

    it('should return null for invalid token', async () => {
      const result = await service.validateToken('invalid-token');
      expect(result).toBeNull();
    });

    it('should return null for inactive admin', async () => {
      const token = service['generateToken'](mockAdmin as Admin);
      (adminRepository.findOne as jest.Mock).mockResolvedValue(null); // Service checks isActive: true in where clause

      const result = await service.validateToken(token);

      expect(result).toBeNull();
    });

    it('should query with correct parameters', async () => {
      const token = service['generateToken'](mockAdmin as Admin);
      mockRepository.findOne.mockResolvedValue(mockAdmin);

      await service.validateToken(token);

      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: { id: mockAdmin.id, isActive: true },
      });
    });
  });

  describe('createAdmin', () => {
    it('should create admin with hashed password', async () => {
      const data = {
        username: 'newadmin',
        email: 'new@admin.com',
        password: 'password123',
        role: AdminRole.ADMIN,
      };

      mockRepository.create.mockReturnValue(data);
      mockRepository.save.mockResolvedValue({ ...data, id: 'new-id' });

      const result = await service.createAdmin(data);

      expect(mockRepository.create).toHaveBeenCalled();
      expect(mockRepository.save).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it('should hash password before saving', async () => {
      const data = {
        username: 'newadmin',
        email: 'new@admin.com',
        password: 'password123',
      };

      mockRepository.create.mockImplementation((input) => input);
      mockRepository.save.mockImplementation((input) => ({ ...input, id: 'new-id' }));

      await service.createAdmin(data);

      const createCall = mockRepository.create.mock.calls[0][0];
      expect(createCall.passwordHash).toContain(':'); // New format
      expect(createCall.passwordHash).not.toBe('password123');
    });

    it('should use default role if not provided', async () => {
      const data = {
        username: 'newadmin',
        email: 'new@admin.com',
        password: 'password123',
      };

      mockRepository.create.mockImplementation((input) => input);
      mockRepository.save.mockImplementation((input) => ({ ...input, id: 'new-id' }));

      await service.createAdmin(data);

      const createCall = mockRepository.create.mock.calls[0][0];
      expect(createCall.role).toBe(AdminRole.ADMIN);
    });
  });

  describe('hasAdmins', () => {
    it('should return true when admins exist', async () => {
      mockRepository.count.mockResolvedValue(5);

      const result = await service.hasAdmins();

      expect(result).toBe(true);
      expect(mockRepository.count).toHaveBeenCalled();
    });

    it('should return false when no admins exist', async () => {
      mockRepository.count.mockResolvedValue(0);

      const result = await service.hasAdmins();

      expect(result).toBe(false);
    });
  });

  describe('generateSecret', () => {
    it('should generate random secret', () => {
      const secret1 = service['generateSecret']();
      const secret2 = service['generateSecret']();

      expect(secret1).toHaveLength(64); // 32 bytes = 64 hex chars
      expect(secret2).toHaveLength(64);
      expect(secret1).not.toBe(secret2);
    });
  });
});
