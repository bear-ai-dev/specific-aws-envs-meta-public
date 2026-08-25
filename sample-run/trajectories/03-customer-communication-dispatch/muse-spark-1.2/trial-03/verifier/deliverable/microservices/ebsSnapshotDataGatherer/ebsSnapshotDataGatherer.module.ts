import { Module } from '@nestjs/common';
import { EbsSnapshotDataGathererService } from './ebsSnapshotDataGatherer.service.js';
import { BullModule } from '@nestjs/bull';

@Module({
    controllers: [],
    providers: [EbsSnapshotDataGathererService],
    imports: [
        BullModule.registerQueue({
            name: 'scheduler_queue',
        }),
    ],
})
export class EbsSnapshotDataGathererModule {}
