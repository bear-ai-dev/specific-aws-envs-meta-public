import { BullModule } from '@nestjs/bull';
import { Module } from '@nestjs/common';
import { Ec2NetworkOutDataGathererService } from './ec2NetworkOutDataGatherer.service.js';

@Module({
    controllers: [],
    providers: [Ec2NetworkOutDataGathererService],
    imports: [
        BullModule.registerQueue({
            name: 'scheduler_queue',
        }),
    ],
})
export class Ec2NetworkOutDataGathererModule {}
