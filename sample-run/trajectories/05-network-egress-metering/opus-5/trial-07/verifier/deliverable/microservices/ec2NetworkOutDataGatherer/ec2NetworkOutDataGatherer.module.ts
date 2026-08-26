import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { Ec2NetworkOutDataGathererService } from './ec2NetworkOutDataGatherer.service.js';

@Module({
    controllers: [],
    providers: [Ec2NetworkOutDataGathererService],
    exports: [Ec2NetworkOutDataGathererService],
    imports: [
        BullModule.registerQueue({
            name: 'scheduler_queue',
        }),
    ],
})
export class Ec2NetworkOutDataGathererModule {}
