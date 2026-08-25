import { Module, forwardRef } from '@nestjs/common';
import { MeasurementService } from './measurement.service.js';
import { MeasurementController } from './measurement.controller.js';
import { InfluxModule } from '../influx/influx.module.js';

@Module({
    controllers: [MeasurementController],
    providers: [MeasurementService],
    imports: [forwardRef(() => InfluxModule)],
    exports: [MeasurementService],
})
export class MeasurementModule {}
