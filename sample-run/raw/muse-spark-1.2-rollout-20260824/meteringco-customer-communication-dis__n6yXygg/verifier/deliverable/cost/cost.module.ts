import { Module, forwardRef } from '@nestjs/common';
import { InfluxModule } from '../influx/influx.module.js';
import { PrivateAPIServicesModule } from '../services/services.module.js';
import { BullModule } from '@nestjs/bull';
import { CostService } from './cost.service.js';
import { CostController } from './cost.controller.js';

@Module({
    controllers: [CostController],
    providers: [CostService],
    imports: [
        forwardRef(() => InfluxModule),
        forwardRef(() => PrivateAPIServicesModule),
        BullModule.registerQueue({
            name: 'scheduler_queue',
        }),
    ],
})
export class CostModule {}
