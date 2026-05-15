import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Order, TimelineLogEntry, Balance, Proxy, RazerAccount, Settings, AdminActivityLog } from './entities';
import { Admin } from '../admin/admin.entity';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get('DB_HOST', 'localhost'),
        port: configService.get<number>('DB_PORT', 5433),
        username: configService.get('DB_USERNAME', 'postgres'),
        password: configService.get('DB_PASSWORD', 'postgres'),
        database: configService.get('DB_DATABASE', 'bag1vbucks'),
        entities: [Order, TimelineLogEntry, Balance, Admin, Proxy, RazerAccount, Settings, AdminActivityLog],
        synchronize: configService.get<boolean>('DB_SYNCHRONIZE', true),
        logging: configService.get<boolean>('DB_LOGGING', false),
        ssl: false,
        extra: {
          ssl: false,
        },
      }),
    }),
    TypeOrmModule.forFeature([Order, TimelineLogEntry, Balance, Admin, Proxy, RazerAccount, Settings, AdminActivityLog]),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
