import { DatetimeUtils } from '../utils/Datetime.js';

export const VALID_INVOICE_TIME_PERIOD = [
    {
        start: new Date('2020-01-01T00:00:00.000Z'),
        end: new Date('2020-01-31T23:59:59.999Z'),
        usageTime: '2020-01-05T00:00:00.000Z',
    },
    {
        start: new Date('2020-01-01T00:00:00.000Z'),
        end: new Date(),
        usageTime: '2020-01-05T00:00:00.000Z',
    },
    {
        start: DatetimeUtils.firstDayOfLastMonth(),
        end: DatetimeUtils.lastDayOfLastMonth(),
        usageTime: DatetimeUtils.firstDayOfLastMonth().toISOString(),
    },
    {
        start: DatetimeUtils.firstDayOfMonth(),
        end: DatetimeUtils.endOfDay(DatetimeUtils.lastDayOfMonth()),
        usageTime: new Date().toISOString(),
    },
    {
        start: new Date(),
        end: DatetimeUtils.endOfDay(DatetimeUtils.lastDayOfMonth()),
        usageTime: new Date().toISOString(),
    },
];
