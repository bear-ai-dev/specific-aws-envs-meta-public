import { ApiProperty, OmitType, getSchemaPath } from '@nestjs/swagger';
import { BasicResponseDTO } from '../../basicResponseDTO';
import { SupportedCurrencies } from '../../offering/dto/SupportedCurrencies';

export enum AnalyticsType {
    MRR = 'MRR',
    ARR = 'ARR',
    ChurnRate = 'ChurnRate',
    LTV = 'LTV',
    NRR = 'NRR',
}
export class BaseAnalyticsData {
    /**
     * The start date of the analytics data. <a href="https://ijmacd.github.io/rfc3339-iso8601/">RFC3339</a> format datetime string.
     * <br><br>
     * Example: `"2021-01-01T00:00:00Z"`
     * @example "2021-01-01T00:00:00Z"
     */
    startDate: string;
    /**
     * The end date of the analytics data. <a href="https://ijmacd.github.io/rfc3339-iso8601/">RFC3339</a> format datetime string.
     * <br><br>
     * Example: `"2021-01-01T00:00:00Z"`
     * @example "2021-01-01T00:00:00Z"
     */
    endDate: string;
    /**
     * The value of the analytics data. This is a string representation of a number. For percentage values, the value should be a string representation of a number between 0 and 1.
     * <br><br>
     * Example: `"1000.00"`
     * Example: `"0.05"`
     * @example "1000.00"
     */
    value: string;
    /**
     * The currency of the analytics data. This is a string representation of a currency code. USD is the only supported currency at this time.
     * <br><br>
     * Example: `"USD"`
     * @example "USD"
     */
    currency = SupportedCurrencies.USD;
}

export class MRRAnaylticsData extends BaseAnalyticsData {
    @ApiProperty({ type: String })
    type = 'MRR';
}
export class ARRAnalyticsData extends BaseAnalyticsData {
    @ApiProperty({ type: String })
    type = 'ARR';
}
export class ChurnRateAnalyticsData extends OmitType(BaseAnalyticsData, ['currency'] as const) {
    @ApiProperty({ type: String })
    type = 'ChurnRate';
}
export class LTVAnalyticsData extends BaseAnalyticsData {
    @ApiProperty({ type: String })
    type = 'LTV';
}
export class NRRAnalyticsData extends BaseAnalyticsData {
    @ApiProperty({ type: String })
    type = 'NRR';
}

export class ReadBusinessAnalyticsDto extends BasicResponseDTO {
    @ApiProperty({
        isArray: true,
        type: 'object',
        oneOf: [
            { $ref: getSchemaPath('MRRAnaylticsData') },
            { $ref: getSchemaPath('ARRAnalyticsData') },
            { $ref: getSchemaPath('ChurnRateAnalyticsData') },
            { $ref: getSchemaPath('LTVAnalyticsData') },
            { $ref: getSchemaPath('NRRAnalyticsData') },
        ],
        minLength: 0,
        example: [
            {
                startDate: '2021-01-01T00:00:00Z',
                endDate: '2021-02-01T00:00:00Z',
                value: '1000.00',
                currency: 'USD',
                type: 'MRR',
            },
            {
                startDate: '2021-01-01T00:00:00Z',
                endDate: '2022-01-01T00:00:00Z',
                value: '12000.00',
                currency: 'USD',
                type: 'ARR',
            },
            {
                startDate: '2021-01-01T00:00:00Z',
                endDate: '2021-02-01T00:00:00Z',
                value: '0.05',
                type: 'ChurnRate',
            },
            {
                startDate: '2021-01-01T00:00:00Z',
                endDate: '2021-02-01T00:00:00Z',
                value: '99.32',
                currency: 'USD',
                type: 'LTV',
            },
            {
                startDate: '2021-01-01T00:00:00Z',
                endDate: '2021-02-01T00:00:00Z',
                value: '800.27',
                currency: 'USD',
                type: 'NRR',
            },
        ],
    })
    data: (MRRAnaylticsData | ARRAnalyticsData | ChurnRateAnalyticsData | LTVAnalyticsData | NRRAnalyticsData)[];
}
