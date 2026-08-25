import { ApiProperty, getSchemaPath, OmitType } from '@nestjs/swagger';
import {
    IsBooleanString,
    IsEnum,
    IsNotEmpty,
    IsNumberString,
    IsObject,
    IsOptional,
    IsRFC3339,
    IsString,
} from 'class-validator';
import { BasicResponseDTO } from '../../basicResponseDTO.js';
import { aggregationInterval } from '../../dimensions/dto/create-dimension.dto.js';
import { ReadDimensionDto } from '../../dimensions/dto/read-dimension.dto.js';
import { StripePaymentResponseDto } from '../../payment/dto/stripePaymentResponse.dto.js';
import { StripeRefundResponseDto } from '../../payment/dto/stripeRefundResponse.dto.js';
import { UsageDocument } from '../../usage/dto/read-usage.dto.js';
import { ReadAllCustomersResponseData, ReadCustomerResponseData } from '../entities/customer.entity.js';
import { CreateCustomerResponseDto } from './create-customer.dto.js';
import { AggregationPurpose } from './AggregationPurpose.js';

export class ReadCustomerResponseDTO extends BasicResponseDTO {
    /**
     * Array of customers
     */
    @ApiProperty({ minItems: 0, isArray: true, type: ReadCustomerResponseData })
    public data: ReadCustomerResponseData[];
}
export class ReadAllCustomerResponseDTO extends BasicResponseDTO {
    /**
     * Array of customers.
     */
    @ApiProperty({ minItems: 0, isArray: true, type: ReadAllCustomersResponseData })
    public data: ReadAllCustomersResponseData[];
}

export class QueryParamUsageDto {
    /**
     * The end time of the time range to query.
     * The time range is inclusive of the start time and exclusive of the end time.
     * The end time must be after the start time.
     * The end time must be before the current time.
     * The end time must be in <a href="https://ijmacd.github.io/rfc3339-iso8601/">RFC3339</a> format.
     * <br><br>
     * Example: `"2020-01-01T00:00:00Z"`
     */
    @IsRFC3339()
    @IsNotEmpty()
    @IsOptional()
    public endTime?: string;

    /**
     * The end time of the time range to query.
     * The time range is inclusive of the start time and exclusive of the end time.
     * The end time must be after the start time.
     * The end time must be before the current time.
     * The end time must be in <a href="https://ijmacd.github.io/rfc3339-iso8601/">RFC3339</a> format.
     * <br><br>
     * Example: `"2020-01-01T00:00:00Z"`
     */
    @IsRFC3339()
    @IsNotEmpty()
    @IsOptional()
    public startTime?: string;

    /**
     * The aggregation interval to use for the query.
     * <br><br>
     * Default: the aggregation interval defined in the dimension definition.
     */
    @ApiProperty()
    @IsOptional()
    @IsEnum(aggregationInterval)
    public aggregationInterval?: aggregationInterval;

    /**
     * If the current offering enrollment date should be ignored for the response data. Enables looking at usage prior to the enrollment date.
     * <br><br>
     * Default: `false`
     */
    @ApiProperty()
    @IsOptional()
    @IsBooleanString()
    public ignoreEnrollmentDate?: string;

    /**
     * The aggregation purpose to use for the query. Enum: `"billing"`, `"metering"`
     * <br><br>
     * Default: "billing"
     */
    @ApiProperty()
    @IsOptional()
    @IsEnum(AggregationPurpose)
    public aggregationPurpose?: AggregationPurpose;
}

export class ReadCustomerUsageData extends BasicResponseDTO {
    /**
     *
     * The usage data for the given customer. If the query parameter `aggregationInterval=none` is passed in the raw usage data is returned, as an UnAggregatedUsageResponse.
     * <br><br>
     * Otherwise, the usage data is aggregated by the given aggregationInterval and returned as an AggregatedUsageResponse.
     */
    @ApiProperty({
        isArray: true,
        type: 'object',
        oneOf: [
            { $ref: getSchemaPath('AggregatedUsageResponse') },
            { $ref: getSchemaPath('UnAggregatedUsageResponse') },
        ],
        minLength: 0,
        example: {
            dimensionId: 'da9611bd-e0f3-4c0d-a754-fda5be730872',
            usage: [
                {
                    value: '0.67',
                    startTime: '2021-01-01T00:00:00.000Z',
                    endTime: '2021-01-01T01:00:00.000Z',
                },
            ],
        },
    })
    public data: Array<AggregatedUsageResponse | UnAggregatedUsageResponse | MetadataGroupedAggregatedUsageResponse>;
}

export class UsageResponseDocument {
    /**
     * The usage record value for the given dimension and time interval.
     * Numerical values are represented as strings to avoid precision loss.
     * <br><br>
     * Example `"0.67"`
     * @example "0.67"
     *
     */
    public value?: UsageDocument['value'];
    /**
     * The start time of the time interval in ISO8601 format.
     * <br><br>
     * Example `"2021-01-01T00:00:00.000Z"`
     *
     * @example "2021-01-01T00:00:00.000Z"
     *
     * */
    public startTime?: UsageDocument['startTime'];
    /**
     * The end time of the time interval in ISO8601 format.
     * <br><br>
     * Example `"2021-01-01T00:00:00.000Z"`
     *
     * @example "2021-01-01T00:00:00.000Z"
     * */
    public endTime?: UsageDocument['endTime'];

    /**
     * An optional key-value map of additional metadata to associate with this usage record.
     * This metadata is used to group usage records together.
     * such as environment, purpose, owner, developer, contract number,
     * or any arbitrary data to be associated with this usage record.
     * <br><br>
     * Example `{"environment": "staging", "purpose": "proof-of-concept", "owner": "John Doe"}`
     * @example {"environment": "staging", "purpose": "proof-of-concept", "owner": "John Doe"}
     **/
    public metadataGroup?: UsageDocument['metadataGroup'];
}

export class AggregatedUsageResponse {
    /**
     * The unique identifier of the offering.
     */
    public offeringId?: string;
    /**
     * The unique identifier of a dimension.
     */
    public dimensionId: ReadDimensionDto['dimensionId'];
    /**
     * Array of usage records group by aggregation time interval
     **/
    public usage: Array<UsageResponseDocument>;
}
export class MetadataGroupedAggregatedUsageResponse extends AggregatedUsageResponse {
    /**
     * An optional key-value map of additional metadata to associate with this usage record.
     * This metadata is used to group usage records together.
     * such as environment, purpose, owner, developer, contract number,
     * or any arbitrary data to be associated with this usage record.
     * <br><br>
     * Example `{"environment": "staging", "purpose": "proof-of-concept", "owner": "John Doe"}`
     * @example {"environment": "staging", "purpose": "proof-of-concept", "owner": "John Doe"}
     **/
    public metadataGroup?: UsageDocument['metadataGroup'];
}
export class BasicUsageDocument {
    /**
     * The timestamp of usage record in <a href="https://ijmacd.github.io/rfc3339-iso8601/">RFC3339</a>
     * format with a 4-digit year.
     * This is the time the usage occurred, or the end of the usage period.
     * <br><br>
     * Example: `"2023-02-08T19:24:10Z"`
     * @example "2023-02-08T19:24:10Z"
     *
     **/
    @IsRFC3339()
    @IsString()
    @IsNotEmpty()
    public timestamp: string;

    /**
     * The amount of the usage on this record.
     * Numerical values are represented as strings to avoid precision loss.
     * <br><br>
     * Example: `"0.87"`
     * @example "0.87"
     **/
    @IsNumberString()
    @IsString()
    public recordValue: string;

    /**
     * An optional key-value map of additional metadata to associate with this usage record.
     * Additional metadata to be stored on the usage record,
     * such as environment, purpose, owner, developer, contract number,
     * or any arbitrary data to be associated with this usage record.
     * Metadata can be used for analytics purpose.
     * <br><br>
     * Example `{"environment": "staging", "purpose": "proof-of-concept", "owner": "John Doe"}`
     * @example {"environment": "staging", "purpose": "proof-of-concept", "owner": "John Doe"}
     **/
    @IsObject()
    @IsOptional()
    public metadata: Record<string, string>;
}

export class UnAggregatedUsageResponse {
    /**
     * The unique identifier of a dimension.
     * <br><br>
     * Example `"12345678-1234-1234-1234-123456789012"`
     */
    public dimensionId: ReadDimensionDto['dimensionId'];

    /**
     * The unique identifier of the offering.
     * <br><br>
     * Example `"12345678-1234-1234-1234-123456789012"`
     */
    public offeringId?: string;
    /**
     * Array of usage records group by aggregation time interval
     **/
    @ApiProperty({ type: BasicUsageDocument, isArray: true })
    public usage: Array<BasicUsageDocument>;
}

export class FindCustomerPaymentsResponse extends BasicResponseDTO {
    @ApiProperty({
        type: StripeRefundResponseDto,
        minItems: 0,
        isArray: true,
    })
    data: Array<StripePaymentResponseDto>;
}

export class FindCustomerRefundsResponse extends BasicResponseDTO {
    @ApiProperty({
        type: StripeRefundResponseDto,
        isArray: true,
        minItems: 0,
    })
    data: Array<StripeRefundResponseDto>;
}

export class CreateCustomerRefundResponse extends BasicResponseDTO {}

export class GetCustomerStripePortalResponse extends OmitType(CreateCustomerResponseDto, ['customerId'] as const) {}

export const customerNotFoundResponseSchema = {
    status: 404,
    description: 'Customer Not Found',
    schema: {
        type: 'object',
        properties: {
            message: {
                type: 'string',
                description: 'The error message',
                example: 'Customer with ID: 807867e0-26ca-4831-846b-a670224db055 not found',
            },
            error: {
                type: 'string',
                description: 'The error name',
                example: 'Not Found',
            },
            statusCode: {
                type: 'number',
                description: 'The HTTP status code',
                example: 404,
                externalDocs: {
                    description: 'MDN Documentation Reference',
                    url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/404',
                },
            },
        },
        example: {
            message: 'Customer with ID: 807867e0-26ca-4831-846b-a670224db055 not found',
            error: 'Not Found',
            statusCode: 404,
        },
        required: ['message', 'error', 'statusCode'],
    },
};
