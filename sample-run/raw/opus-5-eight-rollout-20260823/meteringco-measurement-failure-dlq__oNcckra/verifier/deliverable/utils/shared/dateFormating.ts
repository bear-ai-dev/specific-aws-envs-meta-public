export const toDateString = (date: Date) => {
    return date.toISOString().substring(0, 10);
};

export const getFirstDayOfCurrentMonthUTC = (): Date => {
    const now = new Date();
    const firstDayUTC = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
    return firstDayUTC;
};
