export enum SupportedCurrencies {
    USD = 'USD',
    EUR = 'EUR',
    CNY = 'CNY',
}
export type SupportedOfferingCurrency = Exclude<SupportedCurrencies, SupportedCurrencies.EUR | SupportedCurrencies.CNY>;
export enum SupportedOfferingCurrencyEnum {
    USD = 'USD',
}
