import { forwardRef, Module } from '@nestjs/common';
import { SettingsService } from './settings.service.js';
import { PublicSettingsController, SettingsController } from './settings.controller.js';
import { InfluxModule } from '../influx/influx.module.js';
import { SchedulerModule } from '../scheduler/scheduler.module.js';
import { TaxJarApiKeySetRule, ValidTaxJarApiKeyRule } from './dto/taxJarAuthorizer.js';
import { UsersModule } from '../users/users.module.js';

@Module({
    controllers: [PublicSettingsController],
    providers: [SettingsService, TaxJarApiKeySetRule, ValidTaxJarApiKeyRule],
    imports: [forwardRef(() => InfluxModule), forwardRef(() => SchedulerModule), forwardRef(() => UsersModule)],
    exports: [SettingsService],
})
export class PublicAPISettingModule {}

@Module({
    controllers: [SettingsController],
    providers: [SettingsService, TaxJarApiKeySetRule, ValidTaxJarApiKeyRule],
    imports: [forwardRef(() => InfluxModule), forwardRef(() => SchedulerModule), forwardRef(() => UsersModule)],
    exports: [SettingsService],
})
export class PrivateAPISettingsModule extends PublicAPISettingModule {}
