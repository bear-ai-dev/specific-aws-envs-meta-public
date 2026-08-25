import { Test, TestingModule } from '@nestjs/testing';
import { OnboardingController } from './onboarding.controller.js';
import { OnboardingService } from './onboarding.service.js';
import { LocalJWTAuthService } from '../authz/jwt-local.strategy.js';
import { SettingsService } from '../setting/settings.service.js';
import { JwtService } from '@nestjs/jwt';
import { createMock } from '@golevelup/ts-jest';

describe('OnboardingController', () => {
    let controller: OnboardingController;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [OnboardingController],
            providers: [OnboardingService],
            imports: [],
        })
            .useMocker(createMock)
            .compile();

        controller = module.get<OnboardingController>(OnboardingController);
    });

    it('should be defined', () => {
        expect(controller).toBeDefined();
    });
});
