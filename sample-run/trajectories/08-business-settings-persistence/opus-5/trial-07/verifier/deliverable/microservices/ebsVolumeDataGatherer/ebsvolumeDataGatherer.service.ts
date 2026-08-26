import { fromTemporaryCredentials } from '@aws-sdk/credential-providers';
import { OnQueueFailed, Process, Processor } from '@nestjs/bull';
import { InternalServerErrorException, Logger } from '@nestjs/common';
import { Job } from 'bull';
import { SchedulerEntity } from '../../scheduler/entities/scheduler.entity.js';
import { getAllVolumes } from '../../utils/aws/awsEc2.js';
import { infrastructureType } from '../../dimensions/dto/create-dimension.dto.js';
import { AuditService } from '../../audit/audit.service.js';
import { AuditScope } from '../../audit/entities/audit.interface.js';
import { StandardMeasurementEntity } from '../../measurement-config/entities/standardMeasurement.entity.js';
import { UsageEntity } from '../../usage/entities/usage.entity.js';

@Processor('scheduler_queue')
export class EbsVolumeDataGathererService {
    constructor() {}
    private static readonly logger = new Logger(EbsVolumeDataGathererService.name);
    @Process(infrastructureType.ebsVolumeProvisionedCapacity)
    async readOperationJob({ data: { rate, scheduleParameters, businessID, subject } }: Job<SchedulerEntity>) {
        if ('iamRoleArn' in scheduleParameters) {
            const { iamRoleArn, externalId, dimensionId } = scheduleParameters;
            EbsVolumeDataGathererService.logger.log('Processing Automated EBS data gathering event, logging inputs', {
                rate,
                businessID,
                iamRoleArn,
                externalId,
                subject,
            });

            // Get IAM access

            const creds = fromTemporaryCredentials({
                params: { RoleArn: iamRoleArn, ExternalId: externalId ? externalId : undefined },
                clientConfig: { region: 'us-east-1' },
            });
            console.log('got creds', creds);
            // Get all EBS volumes in the account
            const volumes = await getAllVolumes(creds, [{ Name: 'tag:meteringcoDimensionId', Values: [dimensionId] }]);

            // Convert Data to format for influx
            const regionsForVolumes = Object.keys(volumes);

            regionsForVolumes.map((regionCode) => {
                volumes[regionCode].map(
                    ({ VolumeId, Size, Iops, VolumeType, Tags, State, Throughput, AvailabilityZone }) => {
                        const results = StandardMeasurementEntity.awsTagKeyReducer(Tags);
                        if (Object.keys(results).length) {
                            const { meteringcoCustomerId, meteringcoDimensionId } = results;
                            const entity = new StandardMeasurementEntity({
                                businessID,
                                dimensionId: meteringcoDimensionId,
                                metadata: {
                                    VolumeId,
                                    Iops: Iops ? Iops.toString() : undefined,
                                    Tags: JSON.stringify(Tags),
                                    VolumeType,
                                    State,
                                    Throughput: Throughput ? Throughput.toString() : undefined,
                                    AvailabilityZone,
                                },
                                customerId: meteringcoCustomerId,
                                _measurement: UsageEntity._measurement,
                                recordValue: Size,
                            });
                            StandardMeasurementEntity.publish(entity);
                        }
                    },
                );
            });

            EbsVolumeDataGathererService.logger.log('Finished Gathering Active Volumes');
        } else {
            throw new InternalServerErrorException(
                scheduleParameters,
                'Invalid Schedule Paramters sent to provisioned volume data system',
            );
        } // Throw Errors as needed, DLQ handles them
    }

    @OnQueueFailed({ name: infrastructureType.ebsVolumeProvisionedCapacity })
    jobFailure(job: Job) {
        AuditService.publishEvent({
            message: 'Failed to get EBS Volumes for account',
            data: [job],
            topic: AuditScope.ERROR,
        });
    }
}
