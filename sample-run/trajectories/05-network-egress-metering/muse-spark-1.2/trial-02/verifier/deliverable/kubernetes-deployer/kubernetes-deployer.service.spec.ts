import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { KubernetesDeployerService } from './kubernetes-deployer.service.js';

describe('KubernetesDeployerService', () => {
    let service: KubernetesDeployerService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [KubernetesDeployerService],
        })
            .useMocker(createMock)
            .compile();

        service = module.get<KubernetesDeployerService>(KubernetesDeployerService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });
});
