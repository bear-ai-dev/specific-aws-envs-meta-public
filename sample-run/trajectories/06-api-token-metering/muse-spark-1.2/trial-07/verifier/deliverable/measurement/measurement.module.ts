import { Module, forwardRef } from '@nestjs/common';
import { MeasurementService } from './measurement.service.js';
import { MeasurementController } from './measurement.controller.js';
import { InfluxModule } from '../influx/influx.module.js';
import { TokenConsumerModule } from '../token-consumer/token-consumer.module.js';
import { UsersModule } from '../users/users.module.js';

@Module({
    controllers: [MeasurementController],
    providers: [MeasurementService],
    imports: [forwardRef(() => InfluxModule), forwardRef(() => TokenConsumerModule), forwardRef(() => UsersModule)],
    exports: [MeasurementService],
})
export class MeasurementModule {}
