import { ValidBillingCycles } from '../offering/dto/createOffering.dto.js';

export class DatetimeUtils {
    static oneDay: number = 24 * 60 * 60 * 1000;
    static oneSecond = 1000;
    static getMSDifferenceFromRightNow(date: Date): number {
        return date.getTime() - new Date().getTime();
    }
    static dateIsBetweenTwoDates(date: Date, startDate: Date, endDate: Date): boolean {
        return date >= startDate && date <= endDate;
    }
    static sixHoursAgo(date: Date): Date {
        return new Date(date.getTime() - 6 * 60 * 60 * 1000);
    }

    static getStartOfMonthGivenDate(date: Date): Date {
        const year = date.getUTCFullYear();
        const month = date.getUTCMonth();

        // Create a new Date object with the first day of the month in UTC
        const firstDayOfMonthUTC = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));

        return firstDayOfMonthUTC;
    }
    static isDateInPast(date: Date): boolean {
        const now = new Date();
        return date.getTime() < now.getTime();
    }
    static getLastDayOfMonthGivenDate(date: Date): Date {
        const year = date.getUTCFullYear();
        const month = date.getUTCMonth();

        // Get the number of days in the next month (to determine the last day of the current month)
        const nextMonth = (month + 1) % 12;
        const nextMonthYear = nextMonth === 0 ? year + 1 : year;
        const firstDayOfNextMonth = new Date(Date.UTC(nextMonthYear, nextMonth, 1));
        // Subtract one millisecond to get the last day of the current month
        //eslint-disable-next-line
        //@ts-ignore
        const lastDayOfCurrentMonth = new Date(firstDayOfNextMonth - 1);
        lastDayOfCurrentMonth.setUTCHours(23, 59, 59, 999);

        return lastDayOfCurrentMonth;
    }
    static dateIsLessThan24HoursAgoUTC(date: Date): boolean {
        const now = new Date();
        const yesterday = new Date(now.getTime() - DatetimeUtils.oneDay);
        return date > yesterday;
    }
    static getCurrentUTCTime(): Date {
        const now = new Date();
        const utcNow = new Date(now.getTime() + now.getTimezoneOffset() * 60000); // Convert to UTC
        return utcNow;
    }
    static beginningOfDay(date: Date): Date {
        date.setUTCHours(0, 0, 0, 0);
        return date;
    }
    static nextYear(): Date {
        const date = new Date();
        const lastYear = new Date(
            Date.UTC(date.getUTCFullYear() + 1, date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0),
        );
        return lastYear;
    }
    static nextYearGivenDate(date): Date {
        const lastYear = new Date(
            Date.UTC(date.getUTCFullYear() + 1, date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0),
        );
        return lastYear;
    }
    static randomTimeYesterday(date: Date): Date {
        date.setUTCDate(date.getUTCDate() - 1);
        date.setUTCHours(Math.floor(Math.random() * 24));
        date.setUTCMinutes(Math.floor(Math.random() * 60));
        date.setUTCSeconds(Math.floor(Math.random() * 60));
        date.setUTCMilliseconds(Math.floor(Math.random() * 1000));
        return date;
    }
    static randomTimeAndDateLastMonth(date: Date): Date {
        const currentDate = new Date();
        const randomDate = new Date(
            Date.UTC(
                currentDate.getUTCFullYear(),
                currentDate.getUTCMonth() - 1,
                // We want to pick a random day in the previous month, 28 is the min days in a month
                Math.floor(Math.random() * 25),
                Math.floor(Math.random() * 24),
                Math.floor(Math.random() * 60),
                Math.floor(Math.random() * 60),
                Math.floor(Math.random() * 1000),
            ),
        );

        return randomDate;
    }
    static randomDateTimeForTheRestOftheMonth(): Date {
        // Get the current UTC date
        const currentDate = new Date();

        // Get the days remaining in the month could be 1-31
        const daysRemainingInMonth = DatetimeUtils.daysRemainingInMonth(currentDate);
        // If its 1, then get the hours remaining on that day
        if (daysRemainingInMonth === 1 || daysRemainingInMonth === 0) {
            const hoursRemaining = DatetimeUtils.hoursRemainingInDay(currentDate);
            // Pick a random hour in the future
            const randomHour = Math.floor(Math.random() * hoursRemaining);
            // Set the hour on the current date
            currentDate.setUTCHours(randomHour);
            return currentDate;
        } else {
            // Pick a random day in the future
            const randomDay = Math.floor(Math.random() * daysRemainingInMonth);
            // Set the day on the current date
            currentDate.setUTCDate(currentDate.getUTCDate() + randomDay);
            return currentDate;
        }
    }
    static daysRemainingInMonth(date: Date): number {
        const lastDayOfMonth = new Date(date.getUTCFullYear(), date.getUTCMonth() + 1, 0);
        return lastDayOfMonth.getUTCDate() - date.getUTCDate();
    }
    static hoursRemainingInDay(date: Date) {
        return 24 - date.getUTCHours();
    }

    static fifthDayofTheMonthAtMidnight(date: Date): Date {
        date.setUTCHours(0, 0, 0, 0);
        date.setUTCDate(5);
        return date;
    }
    static fifthDayOfLastMonthAtMidnight(date: Date): Date {
        date.setUTCHours(0, 0, 0, 0);
        date.setUTCMonth(date.getUTCMonth() - 1);
        date.setUTCDate(5);
        return date;
    }
    static beginningOfTomorrow(date: Date): Date {
        date.setUTCHours(0, 0, 0, 0);
        date.setUTCDate(date.getUTCDate() + 1);
        return date;
    }
    static endOfTomorrow(date: Date): Date {
        date.setUTCHours(23, 59, 59, 999);
        date.setUTCDate(date.getUTCDate() + 1);
        return date;
    }
    static endOfDay(date: Date): Date {
        date.setUTCHours(23);
        date.setUTCMinutes(59);
        date.setUTCSeconds(59);
        date.setUTCMilliseconds(999);
        return date;
    }
    static endOfBillingCycle(date: Date, billingCycle: ValidBillingCycles): Date {
        if (billingCycle === ValidBillingCycles.monthly) {
            date.setUTCMonth(date.getUTCMonth() + 1);
            date.setUTCDate(0);
            date.setUTCHours(23);
            date.setUTCMinutes(59);
            date.setUTCSeconds(59);
            date.setUTCMilliseconds(999);
            return date;
        }
    }

    static secondsInTheFuture(seconds: number): Date {
        const date = new Date();
        date.setSeconds(date.getSeconds() + seconds);
        return date;
    }

    static firstDayOfMonth(): Date {
        const currentDate = new Date();
        return new Date(Date.UTC(currentDate.getUTCFullYear(), currentDate.getUTCMonth(), 1, 0, 0, 0, 0));
    }

    static lastDayOfMonth(): Date {
        const currentDate = new Date();
        const lastDayOfMonth = new Date(
            Date.UTC(currentDate.getUTCFullYear(), currentDate.getUTCMonth() + 1, 0, 0, 0, 0, 0),
        );
        return lastDayOfMonth;
    }

    static firstDayOfLastMonth(): Date {
        const currentDate = new Date();
        const firstDayOfLastMonth = new Date(
            Date.UTC(currentDate.getUTCFullYear(), currentDate.getUTCMonth() - 1, 1, 0, 0, 0, 0),
        );
        return firstDayOfLastMonth;
    }

    static lastDayOfLastMonth(): Date {
        const currentDate = new Date();
        const lastDayOfLastMonth = new Date(
            Date.UTC(currentDate.getUTCFullYear(), currentDate.getUTCMonth(), 0, 0, 0, 0, 0),
        );
        return lastDayOfLastMonth;
    }

    static yesterday(): Date {
        const date = new Date();
        date.setUTCDate(date.getUTCDate() - 1);
        return date;
    }
    static lastYearGivenDate(date: Date): Date {
        const lastYear = new Date(
            Date.UTC(date.getUTCFullYear() - 1, date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0),
        );
        return lastYear;
    }
    static daysBeforeDate(date: Date, days: number): Date {
        const newDate = new Date(date.getTime() - days * DatetimeUtils.oneDay);
        return newDate;
    }

    static totalDaysInMonth(): number {
        return (
            Math.round(
                Math.abs(
                    (DatetimeUtils.firstDayOfMonth().getTime() - DatetimeUtils.lastDayOfMonth().getTime()) /
                        DatetimeUtils.oneDay,
                ),
            ) + 1
        );
    }

    static totalMiliSecondsInMonthGivenDay(date: Date): number {
        return Math.round(
            Math.abs(
                DatetimeUtils.getStartOfMonthGivenDate(date).getTime() -
                    DatetimeUtils.getLastDayOfMonthGivenDate(date).getTime(),
            ),
        );
    }

    static getStartOfYearGivenDate(date: Date): Date {
        const year = date.getUTCFullYear();
        const firstDayOfYear = new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0));

        return firstDayOfYear;
    }
    static getEndOfYearGivenDate(date: Date): Date {
        const year = date.getUTCFullYear();
        const lastDayOfYear = new Date(Date.UTC(year, 11, 31, 0, 0, 0, 0));

        return lastDayOfYear;
    }
    static totalMiliSecondsInYearGivenDate(date: Date): number {
        return Math.round(
            Math.abs(
                DatetimeUtils.getStartOfYearGivenDate(date).getTime() -
                    DatetimeUtils.getEndOfYearGivenDate(date).getTime(),
            ),
        );
    }

    static millisecondsOneYearDate(date: Date): number {
        const start = DatetimeUtils.beginningOfDay(date).getTime();
        const end = DatetimeUtils.beginningOfDay(DatetimeUtils.nextYearGivenDate(date)).getTime();
        const result = Math.round(Math.abs(end - start));
        return result;
    }

    static max(dates: Array<string>): string {
        const latestDate = Math.max(...dates.map((date) => new Date(date).getTime()));
        return new Date(latestDate).toISOString();
    }
    static dateToAnnualCronString(inputDate: Date): string {
        const month = (inputDate.getUTCMonth() + 1).toString();
        const day = inputDate.getUTCDate().toString();
        const hours = inputDate.getUTCHours().toString();
        const minutes = inputDate.getUTCMinutes().toString();

        // Creating cron string
        const cronString = `${minutes} ${hours} ${day} ${month} *`;

        return cronString;
    }
}
