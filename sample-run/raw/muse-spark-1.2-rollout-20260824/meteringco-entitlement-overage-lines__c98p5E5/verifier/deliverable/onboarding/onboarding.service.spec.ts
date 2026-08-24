import { Test, TestingModule } from '@nestjs/testing';
import { OnboardingService } from './onboarding.service.js';
import { createMock } from '@golevelup/ts-jest';

describe('OnboardingService', () => {
    let service: OnboardingService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [OnboardingService],
            imports: [],
        })
            .useMocker(createMock)
            .compile();

        service = module.get<OnboardingService>(OnboardingService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });
});
