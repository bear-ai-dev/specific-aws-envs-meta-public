import { V1Deployment, V1Namespace, V1NamespaceList, V1Secret } from '@kubernetes/client-node';
import { Injectable, Logger } from '@nestjs/common';
import { BasicResponseDTO } from '../basicResponseDTO.js';
import { CreateKubernetesDeployerDto } from './dto/create-kubernetes-deployer.dto.js';
import { KubernetesManager } from './entities/kubernetes-deployer.entity.js';

@Injectable()
export class KubernetesDeployerService {
    private static logger = new Logger(KubernetesDeployerService.name);
    async create(createKubernetesDeployerDto: CreateKubernetesDeployerDto): Promise<BasicResponseDTO> {
        KubernetesDeployerService.logger.debug('Creating deployment');
        const kubernetesConfiguration = new KubernetesManager(createKubernetesDeployerDto);
        const k8sCoreApi = KubernetesManager.kubernetesInitCoreAPI();
        // Determine if we need to initalize the kubernetes environment
        const alreadyIntialized = await KubernetesManager.determineIfNamespaceAndSecretsExist({
            k8sApi: k8sCoreApi,
            kubernetesConfiguration,
        });
        KubernetesDeployerService.logger.debug(`Already intialized: ${alreadyIntialized}`);
        if (!alreadyIntialized) {
            await KubernetesManager.initalize({ k8sApi: k8sCoreApi, kubernetesConfiguration });
        }
        const deployer = KubernetesManager.getDeployer({ kubernetesConfiguration });
        await deployer.createDeployment(kubernetesConfiguration);
        return {
            message: `Added new deployment: ${kubernetesConfiguration.deploymentType} for business: ${kubernetesConfiguration.businessID}`,
        };
    }

    async findAllNamespaces(): Promise<V1NamespaceList> {
        KubernetesDeployerService.logger.debug('Find all namespaces');
        const k8sApi = KubernetesManager.kubernetesInitCoreAPI();
        const body = await KubernetesManager.readAllNamespaces(k8sApi);
        return body;
    }

    async findOneDeployment({ deploymentName, namespace }): Promise<V1Deployment> {
        KubernetesDeployerService.logger.debug('Find one deployment');
        const k8sApi = KubernetesManager.kubernetesInitAppsAPI();
        const body = await KubernetesManager.readOneDeployment({ k8sApi, deploymentName, namespace });
        return body;
    }
    async findOneNamespace({ kubernetesManager }): Promise<V1Namespace> {
        KubernetesDeployerService.logger.debug('Find one namespace');
        const k8sApi = KubernetesManager.kubernetesInitCoreAPI();
        const body = await KubernetesManager.readOneNamespace({ k8sApi, kubernetesConfiguration: kubernetesManager });
        return body;
    }
    async findOneSecret({ secretName, namespace }): Promise<V1Secret> {
        KubernetesDeployerService.logger.debug('Find one secret');
        const k8sApi = KubernetesManager.kubernetesInitCoreAPI();
        const body = await KubernetesManager.readOneSecret({ k8sApi, secretName, namespace });
        return body;
    }

    async delete({
        kubernetesManager: kubernetesConfiguration,
    }: {
        kubernetesManager: KubernetesManager;
    }): Promise<BasicResponseDTO> {
        KubernetesDeployerService.logger.debug('Delete deployment');
        const deployer = KubernetesManager.getDeployer({ kubernetesConfiguration });
        await deployer.deleteDeployment(kubernetesConfiguration);
        return {
            message: `Deleted deployment: ${kubernetesConfiguration.deploymentType} for business: ${kubernetesConfiguration.businessID}`,
        };
    }
}
