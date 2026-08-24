import { Module, forwardRef, OnModuleInit, Inject } from '@nestjs/common';
import { MeasurementConfigService } from './measurement-config.service.js';
import { MeasurementConfigController } from './measurement-config.controller.js';
import { InfluxModule } from '../influx/influx.module.js';
import { PrivateAPIDimensionsModule } from '../dimensions/dimensions.module.js';
import { StandardMeasurementEntity } from './entities/standardMeasurement.entity.js';
import { InfluxService } from '../influx/influx.service.js';

@Module({
    controllers: [MeasurementConfigController],
    providers: [MeasurementConfigService],
    imports: [forwardRef(() => InfluxModule), forwardRef(() => PrivateAPIDimensionsModule)],
    exports: [MeasurementConfigService],
})
export class MeasurementConfigModule implements OnModuleInit {
    constructor(@Inject(forwardRef(() => InfluxService)) private influxService: InfluxService) {}
    onModuleInit() {
        StandardMeasurementEntity.subscribe(this.influxService);
    }
}
