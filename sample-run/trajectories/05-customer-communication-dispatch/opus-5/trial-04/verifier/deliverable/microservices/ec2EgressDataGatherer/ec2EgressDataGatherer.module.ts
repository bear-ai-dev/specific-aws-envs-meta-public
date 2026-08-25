import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { Ec2EgressDataGathererService } from './ec2EgressDataGatherer.service.js';

@Module({
    controllers: [],
    providers: [Ec2EgressDataGathererService],
    imports: [
        BullModule.registerQueue({
            name: 'scheduler_queue',
        }),
    ],
})
export class Ec2EgressDataGathererModule {}
