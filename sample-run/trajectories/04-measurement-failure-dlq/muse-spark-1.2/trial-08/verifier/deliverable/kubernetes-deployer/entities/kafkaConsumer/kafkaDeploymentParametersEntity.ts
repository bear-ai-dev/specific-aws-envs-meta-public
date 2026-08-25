import { Point } from '@influxdata/influxdb-client';
import {
    ConflictException,
    InternalServerErrorException,
    Logger,
    NotFoundException,
    NotImplementedException,
} from '@nestjs/common';
import { promisify } from 'util';
import { DeploymentParameters } from '../deploymentParamters.interface.js';
import { KubernetesManager } from '../kubernetes-deployer.entity.js';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import * as k8s from '@kubernetes/client-node';
import { KafkaConsumerConfiguration } from './kafkaConfiguration.entity.js';
import { buildLogstashConfiguration } from './logstashConfiguration.js';
import { KafkaDeploymentParametersDto } from './kafkaDeploymentParametersDto.js';
import { DeploymentType } from '../../dto/DeploymentType.js';
import { KafkaSecurityMechanism } from './KafkaSecurityMechanism.js';
export class KafkaDeploymentParametersEntity extends KafkaDeploymentParametersDto implements DeploymentParameters {
    constructor(deploymentParams?: KafkaDeploymentParametersDto) {
        super(deploymentParams);
    }

    private static logger = new Logger(KafkaDeploymentParametersEntity.name);

    public static transformer(kafkaDeploymentParameters: KafkaDeploymentParametersDto, influxPoint: Point) {
        if (kafkaDeploymentParameters) {
            const { topic, dlqTopic } = kafkaDeploymentParameters;
            if (topic) {
                influxPoint.tag('topic', topic);
            }
            if (dlqTopic) {
                influxPoint.tag('dlqTopic', dlqTopic);
            }
        }
        return influxPoint;
    }
    public static dbModelToEntity({ dlqTopic, topic }: { [x: string]: any }) {
        return new KafkaDeploymentParametersDto({ dlqTopic, topic });
    }
    getOriginalDeploymentParameters: ({
        businessID,
        uniqueId,
        deploymentType,
    }: {
        businessID: string;
        uniqueId?: string;
        deploymentType: DeploymentType;
    }) => Promise<KubernetesManager> = async ({
        uniqueId,
        businessID,
        deploymentType,
    }: {
        businessID: string;
        uniqueId?: string;
        deploymentType: DeploymentType;
    }) => {
        // Initalize core and App API
        const k8sCoreApi = KubernetesManager.kubernetesInitCoreAPI();
        const k8sAppsApi = KubernetesManager.kubernetesInitAppsAPI();
        // Get the deployment if it exists
        const managerWithoutDeployment = { uniqueId, businessID, deploymentType } as KubernetesManager;
        const deploymentName = KafkaConsumerConfiguration.getDeploymentName(managerWithoutDeployment);
        const namespace = await KubernetesManager.getNamespace(managerWithoutDeployment);
        try {
            // Validate that the deployment exists
            await KubernetesManager.readOneDeployment({
                deploymentName,
                namespace,
                k8sApi: k8sAppsApi,
            });
        } catch (err) {
            if (err instanceof NotFoundException) {
                throw new NotFoundException('Deployment not found');
            } else {
                throw err;
            }
        }

        // Read the secrets
        const secretName = KafkaConsumerConfiguration.getSecretName(managerWithoutDeployment);
        const secret = await KubernetesManager.readOneSecret({
            k8sApi: k8sCoreApi,
            namespace,
            secretName,
        });

        // Parse the secret
        const secretString = Buffer.from(secret.data['securityMechanism'], 'base64').toString('utf8');
        if (secretString == KafkaSecurityMechanism.PLAIN) {
            return new KubernetesManager({
                ...managerWithoutDeployment,
                deploymentParameters: {
                    username: Buffer.from(secret.data['username'], 'base64').toString('utf8'),
                    password: Buffer.from(secret.data['password'], 'base64').toString('utf8'),
                    bootstrapServerEndpoint: Buffer.from(secret.data['bootstrapServerEndpoint'], 'base64').toString(
                        'utf8',
                    ),
                    securityMechanism: KafkaSecurityMechanism.PLAIN,
                    dlqTopic: Buffer.from(secret.data['dlqTopic'], 'base64').toString('utf8'),
                    topic: Buffer.from(secret.data['topic'], 'base64').toString('utf8'),
                },
            });
        } else {
            throw new NotImplementedException(`Only PLAIN security mechanism is supported. Recieved ${secretString}`);
        }
    };
    async createDeployment(kubernetesConfiguration: KubernetesManager): Promise<void> {
        const k8sApi = KubernetesManager.kubernetesInitCoreAPI();
        const namespace = await KubernetesManager.getNamespace(kubernetesConfiguration);
        const k8sAppsApi = KubernetesManager.kubernetesInitAppsAPI();

        try {
            await KubernetesManager.createConfigMap({
                k8sApi,
                configMap: await this.buildConfigMap({ kubernetesConfiguration }),
                namespace,
            });
            KafkaDeploymentParametersEntity.logger.debug('Config map created');
        } catch (err) {
            if (err instanceof ConflictException) {
                KafkaDeploymentParametersEntity.logger.debug('Config map already exists');
            } else {
                throw err;
            }
        }
        try {
            await KubernetesManager.createSecret({
                k8sApi,
                secretList: await this.buildSecret({
                    password: this.password,
                    username: this.username,
                    bootstrapServerEndpoint: this.bootstrapServerEndpoint,
                    kubernetesConfiguration,
                    securityMechanism: this.securityMechanism,
                    dlqTopic: this.dlqTopic,
                    topic: this.topic,
                }),
                namespace,
            });
            KafkaDeploymentParametersEntity.logger.debug('Secret created');
        } catch (err) {
            if (err instanceof ConflictException) {
                KafkaDeploymentParametersEntity.logger.debug('Config map already exists');
            } else {
                throw err;
            }
        }
        try {
            await KubernetesManager.createDeployment({
                k8sApi: k8sAppsApi,
                deployment: await this.buildDeployment({ kubernetesConfiguration }),
                namespace,
            });
            KafkaDeploymentParametersEntity.logger.debug('Deployment created');
        } catch (err) {
            if (err instanceof ConflictException) {
                KafkaDeploymentParametersEntity.logger.debug('Deployment already exists');
                throw new ConflictException('Deployment already exists');
            } else {
                throw err;
            }
        }
    }
    private async buildSecret({
        username,
        password,
        bootstrapServerEndpoint,
        kubernetesConfiguration,
        securityMechanism,
        dlqTopic,
        topic,
    }: {
        kubernetesConfiguration: KubernetesManager;
        username: string;
        password: string;
        bootstrapServerEndpoint: string;
        securityMechanism: string;
        dlqTopic?: string;
        topic?: string;
    }): Promise<k8s.V1Secret> {
        // Load the secret from the yaml file in the deploymentResources folder
        const fsReadFileP = promisify(fs.readFile);
        const specPath = 'src/kubernetes-deployer/deploymentResources/kafkaSecret.yaml';
        const specString = await fsReadFileP(specPath, 'utf8');
        const secret: k8s.V1Secret = yaml.load(specString);
        secret.metadata.name = KafkaConsumerConfiguration.getSecretName(kubernetesConfiguration);
        secret.metadata.namespace = KubernetesManager.getNamespace(kubernetesConfiguration);
        secret.data['password'] = Buffer.from(password).toString('base64');
        secret.data['username'] = Buffer.from(username).toString('base64');
        secret.data['bootstrapServerEndpoint'] = Buffer.from(bootstrapServerEndpoint).toString('base64');
        secret.data['securityMechanism'] = Buffer.from(securityMechanism).toString('base64');
        if (dlqTopic) {
            secret.data['dlqTopic'] = Buffer.from(dlqTopic).toString('base64');
        }
        if (topic) {
            secret.data['topic'] = Buffer.from(topic).toString('base64');
        }

        return secret;
    }
    private async buildConfigMap({
        kubernetesConfiguration,
    }: {
        kubernetesConfiguration: KubernetesManager;
    }): Promise<k8s.V1ConfigMap> {
        const { password, username } = kubernetesConfiguration.deploymentParameters as KafkaDeploymentParametersEntity;
        // Load the configmap from the yaml file in the deploymentResources folder
        const fsReadFileP = promisify(fs.readFile);
        const specPath = 'src/kubernetes-deployer/deploymentResources/logstashConfigMap.yaml';
        const specString = await fsReadFileP(specPath, 'utf8');
        const configMap: k8s.V1ConfigMap = yaml.load(specString);
        configMap.data['logstash.conf'] = buildLogstashConfiguration({ kubernetesConfiguration });
        configMap.data['jaas.conf'] = KafkaConsumerConfiguration.createPlainJaaSConfig({
            password,
            username,
        });
        configMap.data['logstash.yml'] = KafkaConsumerConfiguration.createLogstashYamlConfig();
        configMap.metadata.name = KafkaConsumerConfiguration.getConfigMapName(kubernetesConfiguration);
        configMap.metadata.namespace = KubernetesManager.getNamespace(kubernetesConfiguration);
        return configMap;
    }
    private async buildDeployment({
        kubernetesConfiguration,
    }: {
        kubernetesConfiguration: KubernetesManager;
    }): Promise<k8s.V1Deployment> {
        // Load the deployment from the yaml file in the deploymentResources folder
        const fsReadFileP = promisify(fs.readFile);
        const specPath = 'src/kubernetes-deployer/deploymentResources/kafkaConsumerDeployment.yaml';
        const specString = await fsReadFileP(specPath, 'utf8');
        const deployment: k8s.V1Deployment = yaml.load(specString);
        // Set the name of the deployment
        deployment.metadata.name = KubernetesManager.getDeploymentName(kubernetesConfiguration);
        // Set the namespace of the deployment
        deployment.metadata.namespace = KubernetesManager.getNamespace(kubernetesConfiguration);
        // Set the standard affinity and tolerations
        KubernetesManager.setStandardAffinityAndTolerationsForDeployment(deployment);

        deployment.spec.template.spec.volumes =
            KafkaConsumerConfiguration.setDeploymentVolumes(kubernetesConfiguration);

        KafkaDeploymentParametersEntity.logger.debug(JSON.stringify(deployment));

        return deployment;
    }
    async deleteDeployment(kubernetesConfiguration: KubernetesManager): Promise<void> {
        const k8sApi = KubernetesManager.kubernetesInitAppsAPI();
        const k8sCoreApi = KubernetesManager.kubernetesInitCoreAPI();
        const namespace = await KubernetesManager.getNamespace(kubernetesConfiguration);
        try {
            await KubernetesManager.deleteDeployment({
                k8sApi,
                namespace,
                deploymentName: KubernetesManager.getDeploymentName(kubernetesConfiguration),
            });
        } catch (err) {
            if (err instanceof NotFoundException) {
                KafkaDeploymentParametersEntity.logger.debug('Deployment already deleted');
            } else {
                throw err;
            }
        }
        try {
            await KubernetesManager.deleteConfigMap({
                k8sApi: k8sCoreApi,
                configMapName: KafkaConsumerConfiguration.getConfigMapName(kubernetesConfiguration),
                namespace,
            });
        } catch (err) {
            if (err instanceof NotFoundException) {
                KafkaDeploymentParametersEntity.logger.debug('Config map already deleted');
            } else {
                throw err;
            }
        }
        try {
            await KubernetesManager.deleteSecret({
                k8sApi: k8sCoreApi,
                secretName: KafkaConsumerConfiguration.getSecretName(kubernetesConfiguration),
                namespace,
            });
        } catch (err) {
            if (err instanceof NotFoundException) {
                KafkaDeploymentParametersEntity.logger.debug('Secret already deleted');
            } else {
                throw err;
            }
        }
    }
}
