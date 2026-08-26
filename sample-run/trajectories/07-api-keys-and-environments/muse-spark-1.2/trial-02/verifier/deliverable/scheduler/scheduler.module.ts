import { Module, forwardRef } from '@nestjs/common';
import { SchedulerService } from './scheduler.service.js';
import { SchedulerController } from './scheduler.controller.js';
import { InfluxModule } from '../influx/influx.module.js';
import { BullModule } from '@nestjs/bull';
import { MeasurementConfigModule } from '../measurement-config/measurement-config.module.js';

@Module({
    controllers: [SchedulerController],
    providers: [SchedulerService],
    imports: [
        InfluxModule,
        BullModule.registerQueue({
            name: 'scheduler_queue',
        }),
        BullModule.registerQueue({
            name: 'scheduler_billing_queue',
        }),
    ],
    exports: [SchedulerService],
})
export class SchedulerModule {}
