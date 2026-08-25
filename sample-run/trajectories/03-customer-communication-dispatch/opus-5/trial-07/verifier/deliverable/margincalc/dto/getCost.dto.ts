import { IsArray, IsOptional, IsNotEmpty } from 'class-validator';
import { DiscoveryServiceEntity } from '../../influx/entities/discovery.entity.js';

export class GetCostDto {
    /**
     *
     * A list of discovered services
     * @example 
      [ {
            cpuSeconds: 0,
            memoraryBytes: 256761856,
            dataTransferBytesRecieved: 23962,
            dataTransferBytesTransmitted: 17074,
            metadata: {
                label_app: 'meteringco-agent-transformer',
                label_name: 'meteringco-agent-transformer',
                label_meteringco: 'poll-for-me',
                label_pod_template_hash: '57bb5f87c4',
                label_prometheus_io_scrape: 'true',
            },
        },
        {
            cpuSeconds: 0,
            memoraryBytes: 278986752,
            dataTransferBytesRecieved: 7924139,
            dataTransferBytesTransmitted: 12103207,
            metadata: {
                label_app: 'meteringco-agent-transformer',
                label_name: 'meteringco-agent-transformer',
                label_meteringco: 'poll-for-me',
                label_pod_template_hash: '6897986d6d',
                label_prometheus_io_scrape: 'true',
            },
        }]
     */

    @IsNotEmpty()
    @IsArray()
    public data?: Array<DiscoveryServiceEntity>;
}
