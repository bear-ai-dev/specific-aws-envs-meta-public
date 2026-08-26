import { DeploymentType } from '../../dto/DeploymentType.js';
import { KafkaDeploymentParametersEntity } from './kafkaDeploymentParametersEntity.js';
import { KubernetesManager } from '../kubernetes-deployer.entity.js';

const jaas_path = '/usr/share/logstash/config/jaas.conf';
export const buildLogstashConfiguration = ({
    kubernetesConfiguration,
}: {
    kubernetesConfiguration: KubernetesManager;
}): string => {
    const { deploymentParameters, deploymentType, businessID, uniqueId } = kubernetesConfiguration;
    if (deploymentType === DeploymentType.kafkaConsumer) {
        const {
            bootstrapServerEndpoint: bootstrapServerEndpoint,
            topic,
            securityMechanism: securityProtocol,
        } = deploymentParameters as KafkaDeploymentParametersEntity;
        return `input {
            kafka {
                bootstrap_servers => "${bootstrapServerEndpoint}"
                jaas_path => "${jaas_path}"
                sasl_mechanism => "${securityProtocol}"
                security_protocol => "SASL_SSL"
                ssl_endpoint_identification_algorithm => "https"
                topics => ["${topic}"]
                client_id => "meteringco-${uniqueId}"

            }
        }
        filter {
            mutate {
                add_field => { "webtoken" => "jwttoken" }
            } 
            translate {
              dictionary_path => '/usr/share/secrets/token.yml'
              field => 'webtoken'
              destination => 'webtoken'
              override => true
              refresh_interval => 1800
            }
            mutate {  
                    add_field => { "authtoken" => "Bearer %{webtoken}" }
                  }
            }
            output { 
                http { 
                    http_method => "post" 
                    url => "${process.env.METERINGCO_URL}/usage/datastore"
                    headers => { 
                                 "Authorization" => "%{authtoken}" 
                                 "businessID" => "${businessID}" 
                                 "Content-Type" => "application/json"
                                 "deployment-platform" => "${DeploymentType.kafkaConsumer}"
                                 "uniqueId" => "${uniqueId}"
                                } 
                    } 
                }`;
    }
};
