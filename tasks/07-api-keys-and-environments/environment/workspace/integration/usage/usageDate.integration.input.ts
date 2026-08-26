import { AggregationInterval } from '../client/publicClient/dimension.js';
import { DatetimeUtils } from '../utils/Datetime.js';
export const input = [
    {
        startDate: DatetimeUtils.twoMonthsAgo(),
        endDate: DatetimeUtils.today(),
        aggregationInterval: AggregationInterval.Day,
        expectedIntervals: DatetimeUtils.expectedIntervalsBetweenTwoDates(
            DatetimeUtils.twoMonthsAgo(),
            DatetimeUtils.today(),
            AggregationInterval.Day
        ),
        testName: 'Days between 2 months',
    },
    {
        startDate: DatetimeUtils.lastYear(),
        endDate: DatetimeUtils.today(),
        aggregationInterval: AggregationInterval.Day,
        expectedIntervals: DatetimeUtils.expectedIntervalsBetweenTwoDates(
            DatetimeUtils.lastYear(),
            DatetimeUtils.today(),
            AggregationInterval.Day
        ),
        testName: 'Days between last year and today',
    },
    {
        startDate: DatetimeUtils.yesterday(),
        endDate: DatetimeUtils.today(),
        aggregationInterval: AggregationInterval.Hour,
        expectedIntervals: DatetimeUtils.expectedIntervalsBetweenTwoDates(
            DatetimeUtils.yesterday(),
            DatetimeUtils.today(),
            AggregationInterval.Hour
        ),
        testName: 'Hours between yesterday and today',
    },
    {
        startDate: DatetimeUtils.oneHourAgo(),
        endDate: DatetimeUtils.today(),
        aggregationInterval: AggregationInterval.Hour,
        expectedIntervals: DatetimeUtils.expectedIntervalsBetweenTwoDates(
            DatetimeUtils.oneHourAgo(),
            DatetimeUtils.today(),
            AggregationInterval.Hour
        ),
        testName: 'Hours between 1 hour ago and today',
    },
    {
        startDate: DatetimeUtils.oneHourAfterYesterday(),
        endDate: DatetimeUtils.today(),
        aggregationInterval: AggregationInterval.Hour,
        expectedIntervals: DatetimeUtils.expectedIntervalsBetweenTwoDates(
            DatetimeUtils.oneHourAfterYesterday(),
            DatetimeUtils.today(),
            AggregationInterval.Hour
        ),
        testName: 'Hours between 1 hour after yesterday and today',
    },
    {
        startDate: DatetimeUtils.lastDayOfLastMonth(),
        endDate: DatetimeUtils.today(),
        aggregationInterval: AggregationInterval.Day,

        expectedIntervals: DatetimeUtils.expectedIntervalsBetweenTwoDates(
            DatetimeUtils.lastDayOfLastMonth(),
            DatetimeUtils.today(),
            AggregationInterval.Day
        ),
        testName: 'Days between last day of last month and today',
    },
];
