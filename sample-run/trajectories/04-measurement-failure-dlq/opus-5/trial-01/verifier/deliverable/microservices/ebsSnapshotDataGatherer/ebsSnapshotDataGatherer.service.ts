import { fromTemporaryCredentials } from '@aws-sdk/credential-providers';
import { OnQueueFailed, Process, Processor } from '@nestjs/bull';
import { InternalServerErrorException, Logger } from '@nestjs/common';
import { Job } from 'bull';
import { SchedulerEntity } from '../../scheduler/entities/scheduler.entity.js';
import { getAllSnapshots } from '../../utils/aws/awsEc2.js';
import { infrastructureType } from '../../dimensions/dto/create-dimension.dto.js';
import { AuditService } from '../../audit/audit.service.js';
import { AuditScope } from '../../audit/entities/audit.interface.js';
import { StandardMeasurementEntity } from '../../measurement-config/entities/standardMeasurement.entity.js';
import { UsageEntity } from '../../usage/entities/usage.entity.js';

@Processor('scheduler_queue')
export class EbsSnapshotDataGathererService {
    constructor() {}
    private static readonly logger = new Logger(EbsSnapshotDataGathererService.name);
    @Process(infrastructureType.ebsSnapshot)
    async readOperationJob({ data: { rate, scheduleParameters, businessID, subject } }: Job<SchedulerEntity>) {
        if ('iamRoleArn' in scheduleParameters) {
            const { iamRoleArn, externalId, dimensionId } = scheduleParameters;

            EbsSnapshotDataGathererService.logger.log(
                'Processing Automated EBS Snapshots gathering event, logging inputs',
                {
                    rate,
                    businessID,
                    externalId,
                    subject,
                },
            );

            // Get IAM access

            const creds = fromTemporaryCredentials({
                params: { RoleArn: iamRoleArn, ExternalId: externalId ? externalId : undefined },
                clientConfig: { region: 'us-east-1' },
            });
            // Get all EBS volumes in the account
            const snapshots = await getAllSnapshots(creds, [{ Name: 'tag:meteringcoDimensionId', Values: [dimensionId] }]);

            // Convert Data to format for influx
            const regionsForSnapshots = Object.keys(snapshots);

            // Needs to be map so that the promises get await correctly, however we aren't using the return value from influx, since load points returns void.
            await Promise.all(
                regionsForSnapshots.map(async (regionCode) => {
                    snapshots[regionCode].map(
                        ({ VolumeId, SnapshotId, VolumeSize, Tags, StartTime, StorageTier, OwnerId }) => {
                            const results = StandardMeasurementEntity.awsTagKeyReducer(Tags);
                            if (Object.keys(results).length) {
                                const { meteringcoDimensionId, meteringcoCustomerId } = results;
                                const entity = new StandardMeasurementEntity({
                                    businessID,
                                    dimensionId: meteringcoDimensionId,
                                    metadata: {
                                        VolumeId,
                                        SnapshotId,
                                        VolumeSize: VolumeId ? VolumeSize.toString() : undefined,
                                        Tags: JSON.stringify(Tags),
                                        StartTime: StartTime ? StartTime.toString() : undefined,
                                        StorageTier,
                                        OwnerId,
                                    },
                                    customerId: meteringcoCustomerId,
                                    _measurement: UsageEntity._measurement,
                                    recordValue: VolumeSize,
                                });
                                StandardMeasurementEntity.publish(entity);
                            }
                        },
                    );
                }),
            );
            EbsSnapshotDataGathererService.logger.log('Completed Processing', {
                snapshotCount: regionsForSnapshots.reduce((acc, regionCode) => {
                    acc += snapshots[regionCode].length;
                    return acc;
                }, 0),
            });
            // Throw Errors as needed, DLQ handles them
        } else {
            throw new InternalServerErrorException(
                scheduleParameters,
                'Invalid Schedule Parameters sent to snapshot data system',
            );
        }
    }

    @OnQueueFailed({ name: infrastructureType.ebsSnapshot })
    jobFailure(job: Job) {
        AuditService.publishEvent({
            message: 'Failed to get Snapshots for account',
            data: job.data,
            topic: AuditScope.ERROR,
        });
    }
}
