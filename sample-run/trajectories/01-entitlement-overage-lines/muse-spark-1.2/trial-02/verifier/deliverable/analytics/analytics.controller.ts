import { Controller, Get, Query, UseGuards, Req } from '@nestjs/common';
import { AnalyticsService } from './analytics.service.js';
import { AuthGuard } from '@nestjs/passport';
import { ApiExtraModels, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { AuthorizedRequest } from '../authz/jwt-local.gaurd.js';
import {
    NRRAnalyticsData,
    MRRAnaylticsData,
    ARRAnalyticsData,
    LTVAnalyticsData,
    ChurnRateAnalyticsData,
    ReadBusinessAnalyticsDto,
} from './dto/readBusinessAnalytics.dto.js';
import { DatetimeUtils } from '../utils/datetime.js';
@ApiTags('Analytics')
@Controller('analytics')
@ApiExtraModels(NRRAnalyticsData)
@ApiExtraModels(MRRAnaylticsData)
@ApiExtraModels(ARRAnalyticsData)
@ApiExtraModels(LTVAnalyticsData)
@ApiExtraModels(ChurnRateAnalyticsData)
export class AnalyticsController {
    constructor(private readonly analyticsService: AnalyticsService) {}

    @ApiOperation({ operationId: 'GetAll' })
    @UseGuards(AuthGuard('jwt'))
    @Get()
    findAll(
        @Req() request: Request,
        @Query('metric') metric: string,
        @Query('start') start: string,
        @Query('end') end: string,
        @Query('customerId') customerId: string,
    ) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-ignore
        const { businessID } = request.user;
        return this.analyticsService.findAll(businessID, metric, start, end, customerId);
    }

    /**
     * Get all business analytics data
     */
    @ApiOkResponse({
        status: 200,
        description: 'OK',
        type: ReadBusinessAnalyticsDto,
    })
    @ApiOperation({ operationId: 'Find all business analytics' })
    @UseGuards(AuthGuard('jwt'))
    @Get('/business')
    async findAllBusinessAnalytics(
        @Req() request: AuthorizedRequest,
        @Query('start') start?: string,
        @Query('end') end?: string,
    ) {
        const { businessID } = request.user;
        const startTime = start ? new Date(start) : DatetimeUtils.firstDayOfLastMonth();
        const endTime = end ? new Date(end) : DatetimeUtils.lastDayOfLastMonth();

        const [revenue, churn, numberOfCustomers] = await Promise.all([
            this.analyticsService.getRevenueForBusiness({
                businessID,
                start: startTime,
                end: endTime,
            }),
            this.analyticsService.getChurnRateForBusiness({
                businessID,
                start: startTime,
                end: endTime,
            }),
            this.analyticsService.getNumberOfCustomersForBusiness({
                end: endTime,
                businessID,
            }),
        ]);
        const ltv = churn ? revenue / numberOfCustomers / churn : Infinity;
        return {
            message: 'This is a placeholder for the business analytics data',
            data: [
                {
                    startDate: startTime.toISOString(),
                    endDate: endTime.toISOString(),
                    value: revenue.toFixed(2),
                    currency: 'USD',
                    type: 'mrr',
                },
                {
                    startDate: startTime.toISOString(),
                    endDate: DatetimeUtils.nextYearGivenDate(startTime).toISOString(),
                    value: (12 * revenue).toFixed(2),
                    currency: 'USD',
                    type: 'arr',
                },
                {
                    startDate: startTime.toISOString(),
                    endDate: endTime.toISOString(),
                    value: churn.toFixed(2),
                    type: 'churnRate',
                },
                {
                    startDate: startTime.toISOString(),
                    endDate: endTime.toISOString(),
                    value: ltv.toFixed(2),
                    currency: 'USD',
                    type: 'ltv',
                },
                {
                    startDate: startTime.toISOString(),
                    endDate: endTime.toISOString(),
                    value: '800.27',
                    currency: 'USD',
                    type: 'nrr',
                },
                {
                    startDate: startTime.toISOString(),
                    endDate: endTime.toISOString(),
                    value: '201.32',
                    currency: 'USD',
                    type: 'expansionMrr',
                },
                {
                    startDate: startTime.toISOString(),
                    endDate: endTime.toISOString(),
                    value: '0.3',
                    currency: 'USD',
                    type: 'expansionMrrRate',
                },
            ],
        };
    }
}
