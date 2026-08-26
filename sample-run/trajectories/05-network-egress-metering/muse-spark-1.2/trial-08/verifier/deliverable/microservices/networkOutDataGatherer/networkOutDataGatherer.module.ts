import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { NetworkOutDataGathererService } from './networkOutDataGatherer.service.js';

@Module({
    controllers: [],
    providers: [NetworkOutDataGathererService],
    imports: [
        BullModule.registerQueue({
            name: 'scheduler_queue',
        }),
    ],
})
export class NetworkOutDataGathererModule {}
