import { AggregationInterval, aggregationIntervalInMS } from '../client/publicClient/dimension.js';

export class DatetimeUtils {
    static oneDay: number = 24 * 60 * 60 * 1000;

    static beginningOfDay(date: Date) {
        date.setUTCHours(0, 0, 0, 0);
        return date;
    }
    static isSameDay(date1: Date, date2: Date): boolean {
        // Compare the two dates ignoring the time  (HH:MM:SS:MS) component.
        console.log(date1.toISOString(), date2.toISOString(), 'Dates');
        return (
            date1.getFullYear() === date2.getFullYear() &&
            date1.getMonth() === date2.getMonth() &&
            date1.getDate() === date2.getDate()
        );
    }

    static endOfDay(date: Date) {
        date.setUTCHours(23);
        date.setUTCMinutes(59);
        date.setUTCSeconds(59);
        date.setUTCMilliseconds(999);
        return date;
    }

    static firstDayOfMonth(): Date {
        const currentDate = new Date();
        return new Date(Date.UTC(currentDate.getUTCFullYear(), currentDate.getUTCMonth(), 1, 0, 0, 0, 0));
    }

    static lastDayOfMonth(): Date {
        const currentDate = new Date();
        const lastDayOfMonth = new Date(
            Date.UTC(currentDate.getUTCFullYear(), currentDate.getUTCMonth() + 1, 0, 0, 0, 0, 0)
        );
        return lastDayOfMonth;
    }
    static firstDayOfLastMonth() {
        const currentDate = new Date();
        const firstDayOfLastMonth = new Date(
            Date.UTC(currentDate.getUTCFullYear(), currentDate.getUTCMonth() - 1, 1, 0, 0, 0, 0)
        );
        return firstDayOfLastMonth;
    }

    static lastDayOfLastMonth() {
        const currentDate = new Date();
        const lastDayOfLastMonth = new Date(
            Date.UTC(currentDate.getUTCFullYear(), currentDate.getUTCMonth(), 0, 0, 0, 0, 0)
        );
        return lastDayOfLastMonth;
    }
    static lastDayOfLastMonthGivenDate(date: Date) {
        const lastDayOfLastMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 0, 0, 0, 0, 0));
        return lastDayOfLastMonth;
    }

    static totalDaysInMonth() {
        return (
            Math.round(
                Math.abs(
                    (DatetimeUtils.firstDayOfMonth().getTime() - DatetimeUtils.lastDayOfMonth().getTime()) /
                        DatetimeUtils.oneDay
                )
            ) + 1
        );
    }

    static twoMonthsAgo() {
        const startDate2MonthsAgo = new Date(new Date().getTime() - 1000 * 60 * 60 * 24 * 60);

        return DatetimeUtils.dateToUTC(startDate2MonthsAgo);
    }
    static tommorrow() {
        const today = new Date();
        const tomorrow = new Date(today);
        tomorrow.setDate(today.getDate() + 1);
        return tomorrow;
    }

    static dateToUTC(date: Date) {
        return new Date(
            Date.UTC(
                date.getUTCFullYear(),
                date.getUTCMonth(),
                date.getUTCDay(),
                date.getUTCHours(),
                date.getUTCMinutes(),
                date.getUTCSeconds(),
                date.getUTCMilliseconds()
            )
        );
    }
    static yesterday() {
        const yesterday = new Date(new Date().getTime() - 1000 * 60 * 60 * 24);
        return DatetimeUtils.dateToUTC(yesterday);
    }
    static lastYear() {
        const lastYear = new Date(new Date().getTime() - 1000 * 60 * 60 * 24 * 365);

        return DatetimeUtils.dateToUTC(lastYear);
    }
    static oneHourAgo() {
        const oneHourAgo = new Date(new Date().getTime() - 1000 * 60 * 60);
        return DatetimeUtils.dateToUTC(oneHourAgo);
    }
    static fiveMinutesAgo() {
        const fiveMinutesAgo = new Date(new Date().getTime() - 1000 * 60 * 5);
        return DatetimeUtils.dateToUTC(fiveMinutesAgo);
    }
    static oneHourAfterYesterday() {
        const oneHourAfterYesterday = new Date(new Date().getTime() - 1000 * 60 * 60 * 23);
        return DatetimeUtils.dateToUTC(oneHourAfterYesterday);
    }
    static today() {
        const today = new Date();
        return DatetimeUtils.dateToUTC(today);
    }
    static daysAfterDate(date: Date, days: number) {
        const daysAfterDate = new Date(date.getTime() + 1000 * 60 * 60 * 24 * days);
        return daysAfterDate;
    }
    static lastDayOfMonthGivenDate(date: Date) {
        const lastDayOfMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 0, 0, 0, 0));
        return lastDayOfMonth;
    }
    static firstDayOfMonthGivenDate(date: Date) {
        const firstDayOfMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0));
        return firstDayOfMonth;
    }
    static lastYearGivenDate(date: Date) {
        const lastYear = new Date(date.getTime() - 1000 * 60 * 60 * 24 * 365);
        return lastYear;
    }

    static expectedIntervalsBetweenTwoDates(startDate: Date, endDate: Date, aggregationInterval: AggregationInterval) {
        const interval = endDate.getTime() - startDate.getTime();
        const intervalInMilliseconds = aggregationIntervalInMS[aggregationInterval];
        const numberOfIntervals = Math.ceil(interval / intervalInMilliseconds);
        return numberOfIntervals;
    }
}
