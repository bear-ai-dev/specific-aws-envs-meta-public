import { AnalyticsQueryParamters } from '../client/privateClient/analytics.js';

export const ANALYTICS_PARAMETERS_INPUT: AnalyticsQueryParamters[] = [
    { start: '2022-08-01', end: '2023-03-01', metric: 'profitMargin' },
    { start: '2023-01-01', end: '2023-03-01', metric: 'profitMargin' },
    { start: '2023-01-01', end: '2023-03-01', metric: 'revenue' },
];

export const PER_CUSTOMER_CONTRIBUTION_INPUT: AnalyticsQueryParamters[] = [
    { start: '2022-08-01', end: '2023-03-01', metric: 'contributionMarginPerCustomer' },
    { start: '2022-09-01', end: '2023-03-01', metric: 'contributionMarginPerCustomer' },
    { start: '2023-01-01', end: '2023-03-01', metric: 'contributionMarginPerCustomer' },
];
