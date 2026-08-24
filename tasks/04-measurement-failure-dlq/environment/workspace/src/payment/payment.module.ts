import { Module, forwardRef, OnModuleInit, Injectable } from '@nestjs/common';
import { PaymentService } from './payment.service.js';
import { PaymentController } from './payment.controller.js';
import { PrivateAPICustomerModule } from '../customer/customer.module.js';
import { UsersModule } from '../users/users.module.js';
import { PrivateAPISettingsModule } from '../setting/settings.module.js';
import { CreditModule } from '../credit/credit.module.js';
import { PaymentEntity, StripePaymentProcessor } from './entities/payment.entity.js';
import { ModuleRef } from '@nestjs/core';
import { CreditService } from '../credit/credit.service.js';
import { TaxModule } from '../tax/tax.module.js';
import { TaxService } from '../tax/tax.service.js';
import { InfluxModule } from '../influx/influx.module.js';
import { LocalJWTAuthService } from '../authz/jwt-local.strategy.js';
import { AuthzModule } from '../authz/authz.module.js';
import { TokenConsumerModule } from '../token-consumer/token-consumer.module.js';
import { TokenConsumerService } from '../token-consumer/token-consumer.service.js';
import { SettingsService } from '../setting/settings.service.js';

@Module({
    controllers: [PaymentController],
    providers: [PaymentService, StripePaymentProcessor, PaymentEntity],
    imports: [
        forwardRef(() => UsersModule),
        forwardRef(() => PrivateAPICustomerModule),
        forwardRef(() => PrivateAPISettingsModule),
        forwardRef(() => CreditModule),
        forwardRef(() => TaxModule),
        forwardRef(() => InfluxModule),
        forwardRef(() => AuthzModule),
        forwardRef(() => TokenConsumerModule),
    ],
    exports: [PaymentService],
})
export class PaymentModule implements OnModuleInit {
    private creditService: CreditService;
    private taxService: TaxService;
    private localJWTAuthService: LocalJWTAuthService;
    private tokenConsumerService: TokenConsumerService;
    private settingsService: SettingsService;
    constructor(
        private paymentService: PaymentService,
        private moduleRef: ModuleRef,
    ) {}
    onModuleInit() {
        this.creditService = this.moduleRef.get(CreditService, { strict: false });
        this.taxService = this.moduleRef.get(TaxService, { strict: false });
        this.localJWTAuthService = this.moduleRef.get(LocalJWTAuthService, { strict: false });
        this.tokenConsumerService = this.moduleRef.get(TokenConsumerService, { strict: false });
        this.settingsService = this.moduleRef.get(SettingsService, { strict: false });
        PaymentService.subscribe(
            this.creditService,
            this.taxService,
            this.paymentService,
            this.localJWTAuthService,
            this.tokenConsumerService,
            this.settingsService,
        );
    }
}
