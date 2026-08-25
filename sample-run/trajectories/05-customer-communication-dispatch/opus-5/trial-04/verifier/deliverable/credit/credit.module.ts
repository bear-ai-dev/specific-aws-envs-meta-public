import { Module, forwardRef } from '@nestjs/common';
import { CreditService } from './credit.service.js';
import { CreditController } from './credit.controller.js';
import { InfluxModule } from '../influx/influx.module.js';
import { PrivateAPICustomerModule } from '../customer/customer.module.js';

@Module({
    controllers: [CreditController],
    providers: [CreditService],
    imports: [forwardRef(() => PrivateAPICustomerModule), forwardRef(() => InfluxModule)],
    exports: [CreditService],
})
export class CreditModule {}
