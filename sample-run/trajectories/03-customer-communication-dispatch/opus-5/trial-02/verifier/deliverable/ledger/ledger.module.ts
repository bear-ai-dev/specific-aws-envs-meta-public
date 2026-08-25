import { Module, forwardRef } from '@nestjs/common';
import { LedgerService } from './ledger.service';
import { LedgerController } from './ledger.controller';
import { InfluxModule } from '../influx/influx.module';

@Module({
    controllers: [LedgerController],
    providers: [LedgerService],
    imports: [forwardRef(() => InfluxModule)],
    exports: [LedgerService],
})
export class LedgerModule {}
