import { CreateKubernetesDeployerDto } from '../dto/create-kubernetes-deployer.dto.js';
import { DeploymentType } from '../dto/DeploymentType.js';
import { KafkaDeploymentParametersEntity } from './kafkaConsumer/kafkaDeploymentParametersEntity.js';

import * as k8s from '@kubernetes/client-node';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import { promisify } from 'util';
import {
    BadRequestException,
    ConflictException,
    InternalServerErrorException,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { IncomingMessage } from 'http';
import { KafkaConsumerConfiguration } from './kafkaConsumer/kafkaConfiguration.entity.js';
import { DeploymentParameters } from './deploymentParamters.interface.js';
import { KafkaDeploymentParametersDto } from './kafkaConsumer/kafkaDeploymentParametersDto.js';

export class KubernetesManager {
    private static logger = new Logger(KubernetesManager.name);
    public static namespaceSecretName = 'namespace-secret';
    public deploymentParameters?: KafkaDeploymentParametersDto;
    public deploymentType: DeploymentType;
    public businessID: string;
    public uniqueId: string;

    constructor({ deploymentParameters, deploymentType, businessID, uniqueId }: CreateKubernetesDeployerDto) {
        this.deploymentParameters = deploymentParameters;
        this.deploymentType = deploymentType;
        this.businessID = businessID;
        this.uniqueId = uniqueId;
    }
    static getDeploymentName(kubernetesConfiguration: KubernetesManager): string {
        if (kubernetesConfiguration.deploymentType === DeploymentType.kafkaConsumer) {
            return KafkaConsumerConfiguration.getDeploymentName(kubernetesConfiguration);
        }
    }
    static buildNamespaceSecrets({
        kubernetesConfiguration,
    }: {
        kubernetesConfiguration: KubernetesManager;
    }): k8s.V1Secret {
        const namespaceSecrets = new k8s.V1Secret();
        namespaceSecrets.metadata = {
            name: KubernetesManager.namespaceSecretName,
            namespace: KubernetesManager.getNamespace(kubernetesConfiguration),
        };
        namespaceSecrets.data = {
            CLIENT_ID: Buffer.from(process.env.METERINGCO_MEAUSUREMENT_CLIENT_ID).toString('base64'),
            CLIENT_SECRET: Buffer.from(process.env.METERINGCO_MEASUREMENT_CLIENT_SECRET).toString('base64'),
        };
        return namespaceSecrets;
    }
    static getDeployer({
        kubernetesConfiguration,
    }: {
        kubernetesConfiguration: KubernetesManager;
    }): DeploymentParameters {
        const { deploymentParameters } = kubernetesConfiguration;
        if (kubernetesConfiguration.deploymentType === DeploymentType.kafkaConsumer) {
            return new KafkaDeploymentParametersEntity(deploymentParameters);
        } else {
            throw new BadRequestException('Invalid deployment type');
        }
    }

    static async initalize({
        k8sApi,
        kubernetesConfiguration,
    }: {
        k8sApi: k8s.CoreV1Api;
        kubernetesConfiguration: KubernetesManager;
    }): Promise<void> {
        try {
            await KubernetesManager.createNamespace({ k8sApi, kubernetesConfiguration });
            KubernetesManager.logger.debug('Namespace created');
        } catch (e) {
            if (e instanceof ConflictException) {
                KubernetesManager.logger.debug('Namespace already exists');
            } else {
                throw e;
            }
        }

        try {
            await KubernetesManager.createSecret({
                k8sApi,
                secretList: KubernetesManager.buildNamespaceSecrets({ kubernetesConfiguration }),
                namespace: KubernetesManager.getNamespace(kubernetesConfiguration),
            });
            KubernetesManager.logger.debug(`Initalized namespace for ${kubernetesConfiguration.businessID}`);
        } catch (e) {
            if (e instanceof ConflictException) {
                KubernetesManager.logger.debug('Secret already exists');
            } else {
                throw e;
            }
        }
    }
    static getNamespace(kubernetesManager: KubernetesManager): string {
        return kubernetesManager.businessID.toLowerCase();
    }
    static kubernetesInitCoreAPI(): k8s.CoreV1Api {
        const kc = new k8s.KubeConfig();
        process.env.STAGE === 'local' ? kc.loadFromDefault() : kc.loadFromCluster();
        const k8sApi = kc.makeApiClient(k8s.CoreV1Api);
        return k8sApi;
    }
    static kubernetesInitAppsAPI(): k8s.AppsV1Api {
        const kc = new k8s.KubeConfig();
        process.env.STAGE === 'local' ? kc.loadFromDefault() : kc.loadFromCluster();
        const k8sApi = kc.makeApiClient(k8s.AppsV1Api);
        return k8sApi;
    }
    static setStandardAffinityAndTolerationsForDeployment(deployment: k8s.V1Deployment): k8s.V1Deployment {
        const affinity: k8s.V1Affinity = {
            nodeAffinity: {
                requiredDuringSchedulingIgnoredDuringExecution: {
                    nodeSelectorTerms: [
                        {
                            matchExpressions: [
                                { key: 'meteringco-measurement-ingestion', operator: 'In', values: ['true'] },
                            ],
                        },
                    ],
                },
            },
        };
        const tolerations: k8s.V1Toleration[] = [
            {
                key: 'meteringco-measurement-ingestion',
                operator: 'Equal',
                value: 'true',
                effect: 'NoExecute',
            },
        ];
        deployment.spec.template.spec.affinity = affinity;
        deployment.spec.template.spec.tolerations = tolerations;
        return deployment;
    }
    static async determineIfNamespaceAndSecretsExist({
        k8sApi,
        kubernetesConfiguration,
    }: {
        k8sApi: k8s.CoreV1Api;
        kubernetesConfiguration: KubernetesManager;
    }): Promise<boolean> {
        try {
            KubernetesManager.logger.log('Checking if namespace and secrets exist');
            const {
                metadata: { name },
            } = await KubernetesManager.readOneNamespace({ k8sApi, kubernetesConfiguration });
            await KubernetesManager.readOneSecret({
                k8sApi,
                secretName: KubernetesManager.namespaceSecretName,
                namespace: name,
            });

            return true;
        } catch (e) {
            if (e instanceof NotFoundException) {
                KubernetesManager.logger.log('Namespace or secrets do not exist');
                return false;
            } else {
                throw e;
            }
        }
    }

    static async createNamespace({
        k8sApi,
        kubernetesConfiguration,
    }: {
        k8sApi: k8s.CoreV1Api;
        kubernetesConfiguration: KubernetesManager;
    }): Promise<{ response: IncomingMessage; body: k8s.V1Namespace }> {
        // Load the namespace yml from the deploymentResources folder
        const fsReadFileP = promisify(fs.readFile);
        const specPath = 'src/kubernetes-deployer/deploymentResources/businessNamespace.yaml';
        const specString = await fsReadFileP(specPath, 'utf8');
        const namespace: k8s.V1Namespace = yaml.load(specString);
        // Set the name of the namespace to the businessID
        namespace.metadata.name = KubernetesManager.getNamespace(kubernetesConfiguration);
        // Create the namespace
        try {
            const createNamespaceResponse = await k8sApi.createNamespace(namespace);
            KubernetesManager.logger.debug(createNamespaceResponse);
            return createNamespaceResponse;
        } catch (err) {
            KubernetesManager.logger.error('Error creating namespace');
            if (err?.response?.body?.reason === 'AlreadyExists') {
                KubernetesManager.logger.log('Namespace already exists');
                throw new ConflictException('Namespace already exists');
            } else {
                KubernetesManager.logger.error(err);
                throw new InternalServerErrorException('Error creating namespace');
            }
        }
    }

    static async createConfigMap({
        k8sApi,
        configMap,
        namespace,
    }: {
        k8sApi: k8s.CoreV1Api;
        configMap: k8s.V1ConfigMap;
        namespace: string;
    }): Promise<k8s.V1ConfigMap> {
        try {
            const createConfigMapResponse = await k8sApi.createNamespacedConfigMap(namespace, configMap);
            KubernetesManager.logger.debug(createConfigMapResponse);
            return createConfigMapResponse.body;
        } catch (err) {
            KubernetesManager.logger.error('Error creating configmap');
            if (err?.response?.body?.reason === 'AlreadyExists') {
                KubernetesManager.logger.log('Configmap already exists');
                throw new ConflictException('Configmap already exists');
            } else {
                KubernetesManager.logger.error(err);
                KubernetesManager.logger.error(err?.response?.body);
                KubernetesManager.logger.error(err?.response?.headers);
                throw new InternalServerErrorException('Error creating configmap');
            }
        }
    }
    static async createDeployment({
        k8sApi,
        deployment,
        namespace,
    }: {
        k8sApi: k8s.AppsV1Api;
        deployment: k8s.V1Deployment;
        namespace: string;
    }): Promise<k8s.V1Deployment> {
        try {
            const createDeploymentResponse = await k8sApi.createNamespacedDeployment(namespace, deployment);
            KubernetesManager.logger.debug(createDeploymentResponse);
            return createDeploymentResponse.body;
        } catch (err) {
            KubernetesManager.logger.error('Error creating deployment');
            if (err?.response?.body?.reason === 'AlreadyExists') {
                KubernetesManager.logger.log('Deployment already exists');
                throw new ConflictException('Deployment already exists');
            } else {
                KubernetesManager.logger.error(err);
                KubernetesManager.logger.error(err?.response?.body);
                KubernetesManager.logger.error(err?.response?.headers);
                throw new InternalServerErrorException('Error creating deployment');
            }
        }
    }
    static async createSecret({
        k8sApi,
        secretList,
        namespace,
    }: {
        k8sApi: k8s.CoreV1Api;
        secretList: k8s.V1Secret;
        namespace: string;
    }) {
        try {
            KubernetesManager.logger.debug(JSON.stringify(secretList));
            const createSecretResponse = await k8sApi.createNamespacedSecret(namespace, secretList);
            KubernetesManager.logger.debug(createSecretResponse);
            return createSecretResponse.body;
        } catch (err) {
            KubernetesManager.logger.error('Error creating secret');
            if (err?.response?.body?.reason === 'AlreadyExists') {
                KubernetesManager.logger.log('Secret already exists');
                throw new ConflictException('Secret already exists');
            } else {
                KubernetesManager.logger.error(err);
                KubernetesManager.logger.error(err?.response?.body);
                KubernetesManager.logger.error(err?.response?.headers);
                throw new InternalServerErrorException('Error creating secret');
            }
        }
    }

    static async readOneSecret({
        k8sApi,
        secretName,
        namespace,
    }: {
        k8sApi: k8s.CoreV1Api;
        secretName: string;
        namespace: string;
    }): Promise<k8s.V1Secret> {
        try {
            const response = await k8sApi.readNamespacedSecret(secretName, namespace);
            KubernetesManager.logger.debug(response);
            return response.body;
        } catch (err) {
            KubernetesManager.logger.error('Error reading secret');
            if (err?.response?.body?.reason === 'NotFound') {
                KubernetesManager.logger.log('Secret not found');
                throw new NotFoundException('Secret not found');
            } else {
                KubernetesManager.logger.error(err);
                KubernetesManager.logger.error(err?.response?.body);
                KubernetesManager.logger.error(err?.response?.headers);
                throw new InternalServerErrorException('Error reading secret');
            }
        }
    }
    static async readAllNamespaces(k8sApi: k8s.CoreV1Api): Promise<k8s.V1NamespaceList> {
        const { body } = await k8sApi.listNamespace();
        return body;
    }
    static async readOneNamespace({
        k8sApi,
        kubernetesConfiguration,
    }: {
        k8sApi: k8s.CoreV1Api;
        kubernetesConfiguration: KubernetesManager;
    }): Promise<k8s.V1Namespace> {
        try {
            KubernetesManager.logger.debug('Reading namespace');
            const { body } = await k8sApi.readNamespace(KubernetesManager.getNamespace(kubernetesConfiguration));
            return body;
        } catch (err) {
            KubernetesManager.logger.error('Error reading namespace');
            if (err?.response?.body?.reason === 'NotFound') {
                KubernetesManager.logger.log('Namespace not found');
                throw new NotFoundException('Namespace not found');
            } else {
                KubernetesManager.logger.error(err);
                KubernetesManager.logger.error(err?.response?.body);
                KubernetesManager.logger.error(err?.response?.headers);
                throw new InternalServerErrorException('Error reading namespace');
            }
        }
    }
    static async readOneDeployment({
        k8sApi,
        deploymentName,
        namespace,
    }: {
        k8sApi: k8s.AppsV1Api;
        deploymentName: string;
        namespace: string;
    }): Promise<k8s.V1Deployment> {
        try {
            const { body } = await k8sApi.readNamespacedDeployment(deploymentName, namespace);
            return body;
        } catch (err) {
            if (err?.response?.body?.reason === 'NotFound') {
                KubernetesManager.logger.log('Deployment not found');
                throw new NotFoundException(`Deployment: ${deploymentName} not found`);
            } else {
                KubernetesManager.logger.error('Error deleting deployment');
                KubernetesManager.logger.error(err);
                KubernetesManager.logger.error(err?.response?.body);
                KubernetesManager.logger.error(err?.response?.headers);
                throw new InternalServerErrorException('Error deleting deployment');
            }
        }
    }

    static async deleteDeployment({
        k8sApi,
        deploymentName,
        namespace,
    }: {
        k8sApi: k8s.AppsV1Api;
        deploymentName: string;
        namespace: string;
    }) {
        try {
            KubernetesManager.logger.debug('Deleting deployment');
            await k8sApi.deleteNamespacedDeployment(deploymentName, namespace);
        } catch (err) {
            if (err?.response?.body?.reason === 'NotFound') {
                KubernetesManager.logger.log('Deployment not found');
                throw new NotFoundException(`Deployment: ${deploymentName} not found`);
            } else {
                KubernetesManager.logger.error('Error deleting deployment');
                KubernetesManager.logger.error(err);
                KubernetesManager.logger.error(err?.response?.body);
                KubernetesManager.logger.error(err?.response?.headers);
                throw new InternalServerErrorException('Error deleting deployment');
            }
        }
    }
    static async deleteNamespace({
        k8sApi,
        kubernetesConfiguration,
    }: {
        k8sApi: k8s.CoreV1Api;
        kubernetesConfiguration: KubernetesManager;
    }) {
        KubernetesManager.logger.debug('Deleting namespace');
        return k8sApi.deleteNamespace(KubernetesManager.getNamespace(kubernetesConfiguration));
    }
    static async deleteConfigMap({
        k8sApi,
        configMapName,
        namespace,
    }: {
        k8sApi: k8s.CoreV1Api;
        configMapName: string;
        namespace: string;
    }) {
        KubernetesManager.logger.debug('Deleting ConfigMap');
        try {
            await k8sApi.deleteNamespacedConfigMap(configMapName, namespace);
        } catch (err) {
            if (err?.response?.body?.reason === 'NotFound') {
                KubernetesManager.logger.log('ConfigMap not found');
            }
            KubernetesManager.logger.error('Error deleting ConfigMap');
            KubernetesManager.logger.error(err);
            KubernetesManager.logger.error(err?.response?.body);
            KubernetesManager.logger.error(err?.response?.headers);
            throw new NotFoundException(`ConfigMap: ${configMapName} not found`);
        }
    }

    static async deleteSecret({
        k8sApi,
        namespace,
        secretName,
    }: {
        k8sApi: k8s.CoreV1Api;
        namespace: string;
        secretName: string;
    }) {
        try {
            KubernetesManager.logger.debug('Deleting secret');
            await k8sApi.deleteNamespacedSecret(secretName, namespace);
        } catch (err) {
            if (err?.response?.body?.reason === 'NotFound') {
                KubernetesManager.logger.log('Secret not found');
            }
            KubernetesManager.logger.error('Error deleting secret');
            KubernetesManager.logger.error(err);
            KubernetesManager.logger.error(err?.response?.body);
            KubernetesManager.logger.error(err?.response?.headers);
            throw new NotFoundException(`Secret: ${secretName} not found`);
        }
    }
}
