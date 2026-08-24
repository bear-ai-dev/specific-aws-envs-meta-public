import { Module, forwardRef } from '@nestjs/common';
import { AgentMeasurementService } from './agent-measurement.service.js';
import { AgentMeasurementController } from './agent-measurement.controller.js';
import { InfluxModule } from '../influx/influx.module.js';

@Module({
    controllers: [AgentMeasurementController],
    providers: [AgentMeasurementService],
    imports: [forwardRef(() => InfluxModule)],
    exports: [AgentMeasurementService],
})
export class AgentMeasurementModule {}
