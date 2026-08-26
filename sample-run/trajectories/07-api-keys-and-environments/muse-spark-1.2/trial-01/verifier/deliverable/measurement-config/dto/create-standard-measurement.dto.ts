import { ApiHideProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsNotEmpty, IsObject, IsRFC3339, IsNumberString } from 'class-validator';

export class CreateStandardMeasurementDto {
    /**
     * The businessID associated with your account, not needed for full accounts, this is gathered during authentication
     * @example 'My Cool Corp'
     *
     **/
    @ApiHideProperty()
    @IsString()
    @IsOptional()
    public businessID: string;

    /**
     * The timestamp of usage record in <a href="https://ijmacd.github.io/rfc3339-iso8601/">RFC3339</a>
     * format with a 4-digit year.
     * This is the time the usage occurred, or the end of the usage period.
     * <br><br>
     * Example: `"2023-02-08T19:24:10Z"`
     *
     **/
    @IsRFC3339()
    @IsString()
    @IsNotEmpty()
    public timestamp: string;

    /**
     * The unique identifier of the customer this usage record attributes to.
     * <br><br>
     * Example: `"e8366954-6f36-47e9-8431-ac95f88b5cc7"`
     *
     **/
    @IsString()
    @IsNotEmpty()
    public customerId: string;

    /**
     * The unique identifier of the dimension this usage record is associated with.
     * <br><br>
     * Example: `'da9611bd-e0f3-4c0d-a754-fda5be730872'`
     *
     **/
    @IsString()
    @IsNotEmpty()
    public dimensionId?: string;

    /**
     * The amount of the usage on this record.
     * Numerical values are represented as strings to avoid precision loss.
     * <br><br>
     * Example: `"0.87"`
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
     **/
    @IsObject()
    @IsOptional()
    public metadata?: Record<string, string | number | null>;

    constructor(doc) {
        if (doc) {
            this.businessID = doc.businessID;
            this.timestamp = doc.timestamp;
            this.customerId = doc.customerId;
            this.dimensionId = doc.dimensionId;
            this.recordValue = doc.recordValue;
            this.metadata = doc.metadata;
        }
    }
}
