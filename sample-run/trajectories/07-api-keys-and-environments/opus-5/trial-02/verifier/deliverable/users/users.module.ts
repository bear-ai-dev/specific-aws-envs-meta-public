import { Module, forwardRef } from '@nestjs/common';
import { EnvironmentService, OrganizationService, UsersService } from './users.service.js';
import { EnvironmentController, KeysController, OrganizationController, UsersController } from './users.controller.js';
import { InfluxModule } from '../influx/influx.module.js';
import { PublicAPIOfferingModule } from '../offering/offering.module.js';
import { UserEntitlements } from './entities/entitlement.entity.js';
import { PublicAPICustomerModule } from '../customer/customer.module.js';
import { OnboardingEntity } from './entities/onboarding.entity.js';
import { KeysService } from './keys.service.js';

@Module({
    controllers: [UsersController, OrganizationController, EnvironmentController, KeysController],
    providers: [UsersService, OrganizationService, EnvironmentService, UserEntitlements, OnboardingEntity, KeysService],
    imports: [
        forwardRef(() => InfluxModule),
        forwardRef(() => PublicAPIOfferingModule),
        forwardRef(() => PublicAPICustomerModule),
    ],
    exports: [UsersService, EnvironmentService, UserEntitlements, KeysService],
})
export class UsersModule {}
