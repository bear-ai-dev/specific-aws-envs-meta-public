import { Module, forwardRef } from '@nestjs/common';
import { InfluxModule } from '../../influx/influx.module.js';
import { ReservedInstanceService } from './reservedInstance.service.js';
import { BullModule } from '@nestjs/bull';

@Module({
    controllers: [],
    providers: [ReservedInstanceService],
    imports: [
        forwardRef(() => InfluxModule),
        BullModule.registerQueue({
            name: 'scheduler_queue',
        }),
    ],
})
export class ReservedInstanceModule {}
