import { Module } from '@nestjs/common';
import { EbsVolumeDataGathererService } from './ebsvolumeDataGatherer.service.js';
import { BullModule } from '@nestjs/bull';
import { InfluxModule } from '../../influx/influx.module.js';

@Module({
    controllers: [],
    providers: [EbsVolumeDataGathererService],
    imports: [
        BullModule.registerQueue({
            name: 'scheduler_queue',
        }),
    ],
})
export class EbsVolumeDataGathererModule {}
