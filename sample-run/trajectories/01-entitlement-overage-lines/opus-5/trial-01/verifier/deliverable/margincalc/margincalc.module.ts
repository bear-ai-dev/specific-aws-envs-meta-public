import { Module } from '@nestjs/common';
import { MargincalcService } from './margincalc.service.js';
import { MargincalcController } from './margincalc.controller.js';

@Module({
    controllers: [MargincalcController],
    providers: [MargincalcService],
})
export class MargincalcModule {}
