import { Module } from '@nestjs/common';
import { AlertsService } from './alerts.service.js';
import { InfluxModule } from '../influx/influx.module.js';

@Module({
    providers: [AlertsService],
    imports: [InfluxModule],
    exports: [AlertsService],
})
export class AlertsModule {}
