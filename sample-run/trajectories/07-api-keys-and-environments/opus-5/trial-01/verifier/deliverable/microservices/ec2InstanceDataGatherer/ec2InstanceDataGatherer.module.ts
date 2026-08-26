import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { InfluxModule } from '../../influx/influx.module.js';
import { Ec2InstanceDataGathererService } from './ec2InstanceDataGatherer.service.js';

@Module({
    controllers: [],
    providers: [Ec2InstanceDataGathererService],
    imports: [
        BullModule.registerQueue({
            name: 'scheduler_queue',
        }),
    ],
})
export class Ec2InstanceDataGathererModule {}
