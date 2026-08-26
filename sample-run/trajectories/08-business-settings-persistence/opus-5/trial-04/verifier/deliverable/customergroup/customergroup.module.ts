import { Module, forwardRef } from '@nestjs/common';
import { CustomerGroupService } from './customergroup.service';
import { InfluxModule } from '../influx/influx.module';
import { LedgerModule } from '../ledger/ledger.module';

@Module({
    controllers: [],
    providers: [CustomerGroupService],
    exports: [CustomerGroupService],
    imports: [forwardRef(() => InfluxModule), forwardRef(() => LedgerModule)],
})
export class CustomerGroupModule {}
