import { Module, forwardRef } from '@nestjs/common';
import { EnvironmentService, OrganizationService, UsersService } from './users.service.js';
import { OrganizationController, UsersController } from './users.controller.js';
import { EnvironmentController, EnvironmentAdminController } from './environment.controller.js';
import { InfluxModule } from '../influx/influx.module.js';
import { PublicAPIOfferingModule } from '../offering/offering.module.js';
import { UserEntitlements } from './entities/entitlement.entity.js';
import { PublicAPICustomerModule } from '../customer/customer.module.js';
import { OnboardingEntity } from './entities/onboarding.entity.js';

@Module({
    controllers: [UsersController, OrganizationController, EnvironmentController, EnvironmentAdminController],
    providers: [UsersService, OrganizationService, EnvironmentService, UserEntitlements, OnboardingEntity],
    imports: [
        forwardRef(() => InfluxModule),
        forwardRef(() => PublicAPIOfferingModule),
        forwardRef(() => PublicAPICustomerModule),
    ],
    exports: [UsersService, EnvironmentService, UserEntitlements],
})
export class UsersModule {}
