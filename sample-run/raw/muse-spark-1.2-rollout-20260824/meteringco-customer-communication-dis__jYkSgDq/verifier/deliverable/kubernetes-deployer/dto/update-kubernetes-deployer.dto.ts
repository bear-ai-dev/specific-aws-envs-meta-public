import { PartialType } from '@nestjs/swagger';
import { CreateKubernetesDeployerDto } from './create-kubernetes-deployer.dto.js';

export class UpdateKubernetesDeployerDto extends PartialType(CreateKubernetesDeployerDto) {}
