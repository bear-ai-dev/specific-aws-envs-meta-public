import { ApiHideProperty } from '@nestjs/swagger';
import { EbsSnapshotDto } from '../../microservices/ebsSnapshotDataGatherer/dto/ebsSnapshot.dto.js';
import { EbsVolumeDataGathererDto } from '../../microservices/ebsVolumeDataGatherer/dto/ebsVolumeDataGatherer.dto.js';
import { CreateUserDto } from '../../users/dto/create-user.dto.js';
import { SupportedMeasurementFrequencies, SchedulerStatus, schedulerType } from '../dto/scheduler.dto.js';
import { AggregationDto } from '../../dimensions/dto/aggregation.dto.js';
import { CreateBillingReportDto } from '../../billing/dto/createBillingReport.dto.js';
import { Ec2InstanceDataGathererDto } from '../../microservices/ec2InstanceDataGatherer/Dto/ec2InstanceDataGatherer.dto.js';
import { Ec2EgressDataGathererDto } from '../../microservices/ec2EgressDataGatherer/Dto/ec2EgressDataGatherer.dto.js';
import { CostSchedulerDto } from '../../cost/dto/cost.dto.js';
import { EntitlementCheckerDto } from '../../microservices/entitlementChecker/dto/entitlementChecker.dto.js';
import { InvoiceLineGathererDto } from '../../microservices/invoiceLineGatherer/dto/invoiceLineGatherer.dto.js';
import { InvoiceStatusCheckerDto } from '../../microservices/invoiceStatusChecker/dto/invoiceStatusChecker.dto.js';
import { TokenAsyncProcessorDto } from '../../token-consumer/dto/schedulerAsyncProcessor.dto.js';

export class SchedulerEntity {
    @ApiHideProperty()
    public static _measurement = 'SchedulerConfig';

    /**
     *  Represents the unqiue value of the scheduler
     * @example e345f409-daca-4144-91d2-0a0f87c96581
     */
    public schedulerID?: string;

    /**
     * Determines if the scheduler is live or inactive
     * @example 'live'
     * @example 'inactive'
     */
    public schedulerStatus: SchedulerStatus;

    @ApiHideProperty()
    public businessID?: string;

    /**
     * Controls the service called by the scheduler
     * @example "billing"
     */
    public schedulerType: schedulerType;

    /**
     * The parameters to be passed to the scheduler service function
     * Cannot contain the substring "schedulerParam_" (without the quotes). This is due to how we internally model these keys
     * @example {"myCoolKey": "SomeReally1337Value"}
     * @example {"serviceId": "1234abc"}
     * @example {"iamRole": "myCoolIAMRole::", "ExternalID": "foobar"}
     */
    public scheduleParameters:
        | Ec2InstanceDataGathererDto
        | EbsSnapshotDto
        | EbsVolumeDataGathererDto
        | AggregationDto
        | CreateBillingReportDto
        | Ec2EgressDataGathererDto
        | CostSchedulerDto
        | EntitlementCheckerDto
        | InvoiceLineGathererDto
        | InvoiceStatusCheckerDto
        | TokenAsyncProcessorDto;

    /**
     *  The rate for the scheduler to use
     * <br><br>
     *
     * Example: `'0 4 1 * *'`
     * @example '0 4 1 * *'
     */
    public rate: SupportedMeasurementFrequencies;

    /**
     * The subject associated with the user
     * <br><br>
     * Example: `myCoolSubject`
     * @example "myCoolSubject"
     */
    public subject: CreateUserDto['subject'];

    /**
     * The start date for the scheduler
     * <br><br>
     * Example: `1614556800000`
     * @example 1614556800000
     */
    public startDate: number;

    constructor({
        schedulerStatus = SchedulerStatus.live,
        schedulerType,
        businessID,
        scheduleParameters,
        rate,
        schedulerID,
        subject,
    }) {
        this.schedulerStatus = schedulerStatus;
        this.schedulerType = schedulerType;
        this.businessID = businessID;
        this.scheduleParameters = scheduleParameters;
        this.rate = rate;
        this.schedulerID = schedulerID;
        this.subject = subject;
    }
}
