import { IsArray, IsEnum, IsISO8601, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export enum AwsServices {
    EC2 = 'EC2',
}

export class tagList {
    /**
     * The name of the Tag in AWS, must be prepended with the "tag:" portion
     * @example "tag:myCoolTag"
     */
    @IsString()
    public Name: string;

    /**
     * The filter values.
     * Filter values are case-sensitive.
     * If you specify multiple values for a filter, the values are joined with an OR, and the request returns all results that match any of the specified values.
     * @example ["myValue", "anotherValue"]
     */
    @IsArray()
    public Values: string[];
}

export class CreateMargincalcDto {
    /**
     *
     * IAM role with proper user permissions for us to query for. This Role ARN should be associated with our AWS Account ID (123456789012) as a trusted entity
     * @example arn:aws:iam::12222224444:role/test-metering-role
     */

    @IsString()
    @IsNotEmpty()
    public iamRole: string;

    /**
     *
     * An external test Id which is associated with the IAM role, optional
     * @example externalIdTestAbc123
     */

    @IsString()
    @IsOptional()
    public externalID?: string;

    /**
     *
     * The Margin to be calculated on top of the cost, should be a percentage, EX: 0.5 equating to 50%
     * @example 0.4
     */

    @IsString()
    @IsOptional()
    public margin: string;

    /**
     *
     * The set price for the instance uptime calculation
     * @example 0.8
     * The above example being 80 cents per hour.
     *
     **/
    @IsString()
    @IsOptional()
    public setPrice: string;

    /**
     *
     * Start time ISO8601
     */

    @IsISO8601()
    @IsNotEmpty()
    public startTime: string;

    /**
     *
     * End time ISO8601
     */

    @IsISO8601()
    @IsNotEmpty()
    public endTime: string;

    /**
     *
     * A list of the AWS Services which we want to check and apply a margin for
     * @example ["EC2"]
     */

    @IsEnum(AwsServices, { each: true })
    @IsNotEmpty()
    public serviceList: AwsServices[];

    /**
     *
     * A list of tag objects to filter infrastructure on
     * @example [ { "Name": "tag:meteringco-id", "Values": ["MyCoolService"] }]
     */

    @IsOptional()
    @IsArray()
    public tagList?: Array<tagList>;

    /**
     *
     * A region in AWS where the services are located
     */
    @IsString()
    @IsNotEmpty()
    public region: string;
}
