import { Module } from '@nestjs/common';
import { TransformerService } from './transformer.service.js';
import { TrasformerController } from './transformer.controller.js';
import { UsersModule } from '../users/users.module.js';
import { AgentMeasurementModule } from '../agent-measurement/agent-measurement.module.js';

@Module({
    imports: [UsersModule, AgentMeasurementModule],
    controllers: [TrasformerController],
    providers: [TransformerService],
})
export class TransformerModule {}
