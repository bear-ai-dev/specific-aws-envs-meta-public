import { Module } from '@nestjs/common';
import { InfluxService } from './influx.service.js';
@Module({
    controllers: [],
    providers: [InfluxService],
    exports: [InfluxService],
})
export class InfluxModule {}
