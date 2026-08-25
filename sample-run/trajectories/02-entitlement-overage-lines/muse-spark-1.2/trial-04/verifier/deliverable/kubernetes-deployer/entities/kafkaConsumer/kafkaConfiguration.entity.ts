import { KubernetesManager } from '../kubernetes-deployer.entity.js';
import * as k8s from '@kubernetes/client-node';

export class KafkaConsumerConfiguration {
    static createPlainJaaSConfig({ username, password }: { username: string; password: string }): string {
        return `KafkaClient {
            org.apache.kafka.common.security.plain.PlainLoginModule required
            username="${username}"
            password="${password}";
        };`;
    }
    static createLogstashYamlConfig(): string {
        return `
        api.http.host: 0.0.0.0
        path.config: /usr/share/logstash/pipeline`;
    }
    static getDeploymentName(kubernetesConfiguration: KubernetesManager): string {
        const { deploymentType, businessID, uniqueId } = kubernetesConfiguration;
        return `${deploymentType.toLowerCase()}-${businessID.toLowerCase()}-${uniqueId}`;
    }
    static getConfigMapName(kubernetesConfiguration: KubernetesManager): string {
        const { deploymentType, businessID, uniqueId } = kubernetesConfiguration;
        return `${deploymentType.toLowerCase()}-${businessID.toLowerCase()}-configmap-${uniqueId}`;
    }
    static setDeploymentVolumes(kubernetesConfiguration: KubernetesManager): k8s.V1Volume[] {
        return [
            {
                name: `config-volume`,
                configMap: {
                    name: KafkaConsumerConfiguration.getConfigMapName(kubernetesConfiguration),
                    items: [
                        {
                            key: 'jaas.conf',
                            path: 'jaas.conf',
                        },
                        {
                            key: 'logstash.yml',
                            path: 'logstash.yml',
                        },
                    ],
                },
            },
            {
                name: 'logstash-pipeline-volume',
                configMap: {
                    name: KafkaConsumerConfiguration.getConfigMapName(kubernetesConfiguration),
                    items: [
                        {
                            key: 'logstash.conf',
                            path: 'logstash.conf',
                        },
                    ],
                },
            },
            {
                name: 'shared-volume',
                emptyDir: {},
            },
        ];
    }
    static getSecretName(kubernetesConfiguration: KubernetesManager): string {
        const { deploymentType, businessID, uniqueId } = kubernetesConfiguration;
        return `${deploymentType.toLowerCase()}-${businessID.toLowerCase()}-secret-${uniqueId}`;
    }
}
