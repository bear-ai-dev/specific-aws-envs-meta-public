import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { NetworkEgressDataGathererService } from './networkEgressDataGatherer.service.js';

@Module({
    controllers: [],
    providers: [NetworkEgressDataGathererService],
    imports: [
        BullModule.registerQueue({
            name: 'scheduler_queue',
        }),
    ],
})
export class NetworkEgressDataGathererModule {}
