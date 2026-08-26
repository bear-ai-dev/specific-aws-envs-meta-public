import { Inject, InternalServerErrorException, Logger, forwardRef } from '@nestjs/common';
import flattenDeep from 'lodash.flattendeep';
import { InfluxService } from '../../influx/influx.service.js';
import { fromTemporaryCredentials } from '@aws-sdk/credential-providers';
import { getAllInstanceIDs, getAllRegions } from '../../utils/aws/awsEc2.js';
import { InstanceUptimeEntity } from './entities/instanceUptime.entity.js';
import { OnQueueFailed, Process, Processor } from '@nestjs/bull';
import { infrastructureType } from '../../dimensions/dto/create-dimension.dto.js';
import { SchedulerEntity } from '../../scheduler/entities/scheduler.entity.js';
import { Job } from 'bull';
import { AuditService } from '../../audit/audit.service.js';
import { AuditScope } from '../../audit/entities/audit.interface.js';
import { logger } from '@azure/identity';

@Processor('scheduler_queue')
export class InstanceUptimeService {
    private static readonly logger = new Logger(InstanceUptimeService.name);
    constructor(@Inject(forwardRef(() => InfluxService)) readonly InfluxService: InfluxService) {}
    @Process(infrastructureType.podCPUHours)
    async getInstanceUptime({ data: { scheduleParameters, businessID, subject, rate } }: Job<SchedulerEntity>) {
        if ('iamRoleArn' in scheduleParameters) {
            const { iamRoleArn, externalId } = scheduleParameters;
            InstanceUptimeService.logger.log('Processing Automated Instance Uptime gathering event, logging inputs', {
                rate,
                businessID,
                externalId,
                subject,
            });
            const creds = fromTemporaryCredentials({
                params: { RoleArn: iamRoleArn, ExternalId: externalId ? externalId : undefined },
                clientConfig: { region: 'us-east-1' },
            });
            const regions = await getAllRegions(creds);
            const instances = await Promise.all(
                regions.map(async (region) => {
                    try {
                        const instance = await getAllInstanceIDs(region, creds);
                        return instance;
                    } catch (e) {
                        InstanceUptimeService.logger.error("Couldn't get instance IDs", e);
                        return undefined;
                    }
                }),
            );

            // Put instances in influx with the following schema
            const flattenedListOfInstances = flattenDeep(instances);
            const filteredInstances = flattenedListOfInstances.filter((element) => element);
            const points = await Promise.all(
                filteredInstances.map(
                    ({
                        InstanceId: instanceID,
                        State: status,
                        Tags: metadata,
                        LaunchTime: startTime,
                        Memory,
                        CpuCores,
                        PrivateDnsName,
                        InstanceType,
                        region,
                    }) =>
                        InstanceUptimeEntity.transformer(
                            new InstanceUptimeEntity({
                                instanceID,
                                status,
                                metadata,
                                startTime,
                                businessID,
                                memory: Memory,
                                cpuCores: CpuCores,
                                privateDNS: PrivateDnsName,
                                instanceType: InstanceType,
                                region,
                            }),
                            this.InfluxService,
                        ),
                ),
            );
            InstanceUptimeService.logger.log('Loading Instance Uptime Entity Points into Influx', points.length);
            const vaildPoints = points.filter((element) => element);
            const { loadPoints } = this.InfluxService;
            // InstanceMetaData | status (tag)  | instanceID (string field) | price (tag)|  ... all other tags
            const results = await loadPoints(`${process.env.STAGE}-usage-data`, process.env.INFLUX_ORG, vaildPoints);
            return results;
        } else {
            throw new InternalServerErrorException('iamRoleArn not found in scheduleParameters');
        }
    }
    @OnQueueFailed({ name: infrastructureType.podCPUHours })
    jobFailure(job: Job) {
        AuditService.publishEvent({
            message: 'Failed to gather instance uptime',
            data: job.data,
            topic: AuditScope.ERROR,
        });
    }
}
