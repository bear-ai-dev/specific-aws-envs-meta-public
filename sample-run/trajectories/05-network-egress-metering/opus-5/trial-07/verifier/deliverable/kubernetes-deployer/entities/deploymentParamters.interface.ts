import { KubernetesManager } from './kubernetes-deployer.entity.js';
import { DeploymentType } from '../dto/DeploymentType.js';

export interface DeploymentParameters {
    createDeployment: (kubernetesConfiguration: KubernetesManager) => Promise<void>;
    deleteDeployment: (kubernetesConfiguration: KubernetesManager) => Promise<void>;
    getOriginalDeploymentParameters: ({
        businessID,
        uniqueId,
        deploymentType,
    }: {
        businessID: string;
        uniqueId?: string;
        deploymentType: DeploymentType;
    }) => Promise<KubernetesManager>;
}
