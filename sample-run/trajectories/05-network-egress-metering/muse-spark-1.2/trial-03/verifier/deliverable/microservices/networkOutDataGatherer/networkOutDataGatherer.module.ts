import { BullModule } from '@nestjs/bull';
import { Module } from '@nestjs/common';
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
