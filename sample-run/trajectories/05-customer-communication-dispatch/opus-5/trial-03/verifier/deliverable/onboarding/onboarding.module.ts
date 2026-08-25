import { forwardRef, Module } from '@nestjs/common';
import { OnboardingService } from './onboarding.service.js';
import { OnboardingController } from './onboarding.controller.js';
import { PrivateAPISettingsModule } from '../setting/settings.module.js';
import { AuthzModule } from '../authz/authz.module.js';

@Module({
    controllers: [OnboardingController],
    providers: [OnboardingService],
    imports: [PrivateAPISettingsModule, forwardRef(() => AuthzModule)],
})
export class OnboardingModule {}
