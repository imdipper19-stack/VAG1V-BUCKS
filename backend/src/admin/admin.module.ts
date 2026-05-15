import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Admin } from './admin.entity';
import { AdminAuthService } from './admin-auth.service';
import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthGuard } from './admin-auth.guard';
import { SeedService } from './seed.service';
import { CommonModule } from '../common/common.module';

@Module({
  imports: [TypeOrmModule.forFeature([Admin]), forwardRef(() => CommonModule)],
  controllers: [AdminAuthController],
  providers: [AdminAuthService, AdminAuthGuard, SeedService],
  exports: [AdminAuthService, AdminAuthGuard, TypeOrmModule],
})
export class AdminModule {}
