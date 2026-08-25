import { ApiHideProperty } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsEnum, IsInt, IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';
import { BasicResponseDTO } from '../../basicResponseDTO.js';
import { CronExpression } from '@nestjs/schedule';
import { SchedulerEntity } from '../entities/scheduler.entity.js';
import { CreateUserDto } from '../../users/dto/create-user.dto.js';
import { EbsSnapshotDto } from '../../microservices/ebsSnapshotDataGatherer/dto/ebsSnapshot.dto.js';
import { EbsVolumeDataGathererDto } from '../../microservices/ebsVolumeDataGatherer/dto/ebsVolumeDataGatherer.dto.js';
import { NodeUptimeDto } from '../../microservices/instanceUpTime/dto/instanceUptimeDTO.js';
import { InstanceHistoryDto } from '../../microservices/reservedInstanceHistory/dto/reservedInstance.dto.js';
import { AggregationDto } from '../../dimensions/dto/aggregation.dto.js';
import { CreateBillingReportDto } from '../../billing/dto/createBillingReport.dto.js';
import { CostSchedulerDto } from '../../cost/dto/cost.dto.js';
import { EntitlementCheckerDto } from '../../microservices/entitlementChecker/dto/entitlementChecker.dto.js';
import { InvoiceStatusCheckerDto } from '../../microservices/invoiceStatusChecker/dto/invoiceStatusChecker.dto.js';
import {
    TokenAsyncAggregatorDto,
    TokenAsyncProcessorDto,
} from '../../token-consumer/dto/schedulerAsyncProcessor.dto.js';

export enum SchedulerStatus {
    live = 'live',
    inactive = 'inactive',
}

export enum schedulerType {
    billing = 'billing',
    dimensionDataGathering = 'dimensionDataGathering',
    cost = 'cost',
}
enum expandedTimes {
    FIRST_DAY_OF_MONTH = '0 4 1 * *',
    FIRST_DAY_OF_MONTH_AT_NOON = '0 12 1 * *',
}
export enum SupportedMeasurementFrequencies {
    monthly = expandedTimes.FIRST_DAY_OF_MONTH,
    weekly = CronExpression.EVERY_WEEK,
    annual = CronExpression.EVERY_YEAR,
    perMinute = CronExpression.EVERY_MINUTE,
    everyFiveMinutes = CronExpression.EVERY_5_MINUTES,
    everyThirtyMinutes = CronExpression.EVERY_30_MINUTES,
    everyHour = CronExpression.EVERY_HOUR,
    daily = CronExpression.EVERY_DAY_AT_MIDNIGHT,
    monthlyAtNoon = expandedTimes.FIRST_DAY_OF_MONTH_AT_NOON,
    everySixHours = '0 */6 * * *',
}
export class SchedulerDto {
    /**
     *  Represents the unqiue value of the scheduler, when creating a schedule this is optional, if none is provided a UUID will be generated for you.
     * @example e345f409-daca-4144-91d2-0a0f87c96581
     */
    @IsString()
    @IsOptional()
    public schedulerID?: string;

    /**
     *  Run the scheduled action immediately (and then again at the chosen rate)
     * @example true
     */
    @IsBoolean()
    @IsOptional()
    public startNow?: boolean;

    /**
     * Determines if the scheduler is live or inactive
     * @example 'live'
     * @example 'inactive'
     */
    @IsEnum(SchedulerStatus)
    @IsNotEmpty()
    public schedulerStatus: SchedulerStatus;

    /**
     * The unique identifier for the SaaS business
     * @example myCoolCorp
     */
    @ApiHideProperty()
    @IsString()
    @IsOptional()
    public businessID: string;

    /**
     * The subject associated with the user
     */
    @ApiHideProperty()
    @IsString()
    @IsOptional()
    public subject: CreateUserDto['subject'];
    /**
     * Controls the service called by the scheduler
     * @example "billing"
     */
    @IsEnum(schedulerType)
    @IsNotEmpty()
    public schedulerType: schedulerType;

    /**
     * The parameters to be passed to the scheduler service function
     * Cannot contain the substring "schedulerParam_" (without the quotes). This is due to how we internally model these keys
     * @example {"myCoolKey": "SomeReally1337Value"}
     */
    @IsObject()
    @IsNotEmpty()
    scheduleParameters:
        | EbsSnapshotDto
        | EbsVolumeDataGathererDto
        | NodeUptimeDto
        | InstanceHistoryDto
        | AggregationDto
        | CreateBillingReportDto
        | CostSchedulerDto
        | EntitlementCheckerDto
        | InvoiceStatusCheckerDto
        | TokenAsyncProcessorDto
        | TokenAsyncAggregatorDto;

    /**
     *  The rate for the scheduler to use
     * @example perMinute
     */
    @IsEnum(SupportedMeasurementFrequencies)
    @IsNotEmpty()
    public rate: SupportedMeasurementFrequencies | string;

    /**
     * The date to start the scheduler
     * <br><br>
     * Example: `1995-12-17T03:24:00Z`
     * @example 2024-12-17T03:24:00Z
     **/
    @IsOptional()
    @IsDateString()
    public startDate?: string;
}
export class SchedulerReadResponseDTO extends BasicResponseDTO {
    data: Array<SchedulerCreationResponse | SchedulerEntity>;
}

export class SchedulerCreationResponse {
    public key?: string;
    public cron?: string;
    public id?: string;
}

export class SchedulerDeletionResponse extends SchedulerReadResponseDTO {}
