import { Module, forwardRef } from '@nestjs/common';
import { EnvironmentService, OrganizationService, UsersService } from './users.service.js';
import { EnvironmentController, OrganizationController, UsersController } from './users.controller.js';
import { KeysController } from './keys.controller.js';
import { KeysService } from './keys.service.js';
import { InfluxModule } from '../influx/influx.module.js';
import { PublicAPIOfferingModule } from '../offering/offering.module.js';
import { UserEntitlements } from './entities/entitlement.entity.js';
import { PublicAPICustomerModule } from '../customer/customer.module.js';
import { OnboardingEntity } from './entities/onboarding.entity.js';

@Module({
    controllers: [UsersController, OrganizationController, EnvironmentController, KeysController],
    providers: [UsersService, OrganizationService, EnvironmentService, KeysService, UserEntitlements, OnboardingEntity],
    imports: [
        forwardRef(() => InfluxModule),
        forwardRef(() => PublicAPIOfferingModule),
        forwardRef(() => PublicAPICustomerModule),
    ],
    exports: [UsersService, EnvironmentService, KeysService, UserEntitlements],
})
export class UsersModule {}
