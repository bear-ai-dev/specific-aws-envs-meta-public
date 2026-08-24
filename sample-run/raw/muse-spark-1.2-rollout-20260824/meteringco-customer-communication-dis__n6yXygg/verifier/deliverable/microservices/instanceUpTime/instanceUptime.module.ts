import { Module, forwardRef } from '@nestjs/common';
import { InfluxModule } from '../../influx/influx.module.js';
import { InstanceUptimeService } from './instanceUptime.service.js';
import { BullModule } from '@nestjs/bull';

@Module({
    controllers: [],
    providers: [InstanceUptimeService],
    imports: [
        forwardRef(() => InfluxModule),
        BullModule.registerQueue({
            name: 'scheduler_queue',
        }),
    ],
})
export class InstanceUptimeModule {}
