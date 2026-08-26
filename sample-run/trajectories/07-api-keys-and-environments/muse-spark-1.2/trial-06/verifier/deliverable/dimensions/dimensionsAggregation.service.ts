import { forwardRef, Inject, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { InfluxService } from '../influx/influx.service.js';
import { aggregationInterval, roundingEnum } from './dto/create-dimension.dto.js';
import { MeasurementConfigService } from '../measurement-config/measurement-config.service.js';
import { Process, Processor } from '@nestjs/bull';
import { OfferingService } from '../offering/offering.service.js';
import flattenDeep from 'lodash.flattendeep';
import { DimensionsService } from './dimensions.service.js';
import { AggregationDto } from './dto/aggregation.dto.js';
import { Job } from 'bull';
import { SupportedMeasurementFrequencies } from '../scheduler/dto/scheduler.dto.js';
import { SchedulerEntity } from '../scheduler/entities/scheduler.entity.js';
import { UsageService } from '../usage/usage.service.js';

import { StandardMeasurementEntity } from '../measurement-config/entities/standardMeasurement.entity.js';
import { AggregateUsageEntity } from '../usage/entities/usage.entity.js';
import { MeasurementFormat } from '../measurement-config/entities/measurement.interface.js';
import { AuditService } from '../audit/audit.service.js';
import { AuditScope } from '../audit/entities/audit.interface.js';
import { CustomerService } from '../customer/customer.service.js';
import { AggregatedUsageResponse } from '../customer/dto/read-customer.dto.js';

@Processor('scheduler_queue')
export class DimensionAggregationService {
    private static readonly logger = new Logger(DimensionAggregationService.name);
    constructor(
        readonly InfluxService: InfluxService,
        @Inject(forwardRef(() => MeasurementConfigService)) readonly measurementConfigService: MeasurementConfigService,
        @Inject(forwardRef(() => OfferingService)) readonly offeringService: OfferingService,
        @Inject(forwardRef(() => CustomerService)) readonly customerService: CustomerService,
        @Inject(forwardRef(() => DimensionsService)) readonly dimensionsService: DimensionsService,
        @Inject(forwardRef(() => UsageService)) readonly usageService: UsageService,
    ) {}

    @Process({ name: 'aggregation' })
    public async aggregateUsage({ data: { scheduleParameters } }: Job<SchedulerEntity>) {
        // Get the dimension
        const { businessID, dimensionId, rate } = scheduleParameters as AggregationDto;
        DimensionAggregationService.logger.log(`Starting aggregation for dimension: ${dimensionId}`);
        // Find services by dimensionId
        const customers = await this.getCustomersUsingDimension({ dimensionId, businessID });
        // Get rate to timeRange
        const {
            data: [dimension],
        } = await this.dimensionsService.findOne({ dimensionId, businessID });
        const { aggregationInterval: dimensionAggregationInterval } = dimension;
        const { timeSegments } = this.cronRateToHoursElapsed(rate, dimensionAggregationInterval);
        const start = timeSegments[0]?.startTime;
        const end = timeSegments[timeSegments.length - 1]?.endTime;
        await Promise.all(
            customers.map(async (customerId) => {
                const aggregateUsageData = (await this.usageService.findUsageForCustomer(
                    { customerId, businessID },
                    { startTime: start.toISOString(), endTime: end.toISOString() },
                )) as AggregatedUsageResponse[];
                const points = await Promise.all(
                    aggregateUsageData
                        .find(({ dimensionId: usageDimensionId }) => usageDimensionId === dimensionId)
                        ?.usage.map(async (usage) => {
                            const { value, startTime } = usage;
                            const entity = new StandardMeasurementEntity({
                                _measurement: AggregateUsageEntity._measurement,
                                dimensionId,
                                businessID,
                                customerId,
                                timestamp: startTime,
                                recordValue: parseFloat(value),
                                metadata: {},
                            });
                            const point = MeasurementFormat.getPointForm(entity, this.InfluxService);
                            return point;
                        }),
                );
                if (points) {
                    try {
                        await this.InfluxService.loadPoints(
                            `${process.env.STAGE}-aggregate-usage`,
                            process.env.INFLUX_ORG,
                            points,
                        );
                    } catch (e) {
                        AuditService.publishEvent({
                            topic: AuditScope.ERROR,
                            message: `Error loading points for customer: ${customerId}`,
                            data: [{ error: e, points }],
                        });
                    }
                } else {
                    DimensionAggregationService.logger.log(`No usage found for service: ${customerId}`);
                }
            }),
        );
    }

    private async getCustomersUsingDimension({ dimensionId, businessID }): Promise<string[]> {
        // Find all offerings which are using this dimension
        const { data: offeringIds } = await this.offeringService.findOfferingIdsByDimensionId({
            dimensionId,
            businessID,
        });

        // Get their offeringIds
        // Lookup all customers which are using these offeringIds

        const customerIds = flattenDeep(
            await Promise.all(
                offeringIds.map(async (offeringId) => {
                    const { data } = await this.customerService.findAllCustomersWithOfferingId({
                        offeringId,
                        businessID,
                    });
                    return data.map(({ customerId }) => customerId);
                }),
            ),
        );
        return customerIds;
    }

    /***
     * The cronRate to Hours Elapsed function converts a cron rate to the number of hours elapsed between each execution.
     * It additionally splits the time into segments of the number of hours elapsed.
     * So for example if the cron rate is every 24 hours and the time delta is 1 hour, then the timeSegments array length will be 24.
     * With a startime at midnight and an end time at 1am for the  0th index, and a start time at 1am and an end time at 2am for the 1st index. etc...
     *
     * @param rate - String in Hours, @example: "1"
     * @param dimensionAggregationInterval - The time delta for the aggregation
     * @private
     */
    private cronRateToHoursElapsed(
        rate: SupportedMeasurementFrequencies,
        dimensionAggregationInterval: aggregationInterval,
    ): { timeDelta: string; timeSegments: Array<{ startTime: Date; endTime: Date }> } {
        if (
            rate === SupportedMeasurementFrequencies.daily &&
            dimensionAggregationInterval === aggregationInterval.hour
        ) {
            const hoursElapsed = 24;
            const timeSegments = [];
            for (let i = 0; i < hoursElapsed; i++) {
                // Without Moment

                const startTime = new Date(new Date().setUTCHours(i, 0, 0, 0));
                const endTime = new Date(new Date().setUTCHours(i + 1, 0, 0, 0));

                timeSegments.push({ startTime, endTime });
            }
            return { timeDelta: aggregationInterval.hour, timeSegments };
        } else {
            throw new InternalServerErrorException(
                'Failed to convert cron rate to hours elapsed, only 24 hours supported with a aggregationInterval of "hour"',
            );
        }
    }
}
