import { Module } from '@nestjs/common';
import { KubernetesDeployerService } from './kubernetes-deployer.service.js';

@Module({
    providers: [KubernetesDeployerService],
})
export class KubernetesDeployerModule {}
