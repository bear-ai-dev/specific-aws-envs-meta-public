import { ApiProperty } from '@nestjs/swagger';
import { BasicResponseDTO } from '../../basicResponseDTO';
import { ReadOfferingResponseData } from '../../offering/dto/readOffering.dto';
import { Offering } from '../../offering/entities/offeringPackage.entity';
import { ContractEntity } from '../entities/contract.entity';
import { CustomOverrides } from './prepareContractResponse.dto';

export class ReadContractResponseDto {
    public offering?: Offering;
    public overridesForOffering?: CustomOverrides;
    public offeringEnrollmentDate: string;
    public readOfferingResponseData?: ReadOfferingResponseData;
    public customerId: string;
    public offeringId: string;

    constructor(fields: ContractEntity, offeringResponseData?: ReadOfferingResponseData) {
        // Takes in an offering, customerId, and businessID and overrides
        // Returns the latest contract for that customer which is basically the offering with overrides.
        // Sets the offering values correctly so that it can be used to enroll/unenroll the customer in the offering.
        if (fields) {
            const {
                discount,
                offering,
                offeringId,
                offeringEnrollmentDate,
                freeTrialEndDate,
                customerId,
                dimensionOverrides,
            } = fields;
            if (freeTrialEndDate) {
                offering.freeTrialEndDate = freeTrialEndDate;
            }
            if (discount) {
                offering.discount = discount;
            }
            if (dimensionOverrides) {
                offering.dimensions = offering.dimensions.map((dimension) => {
                    const override = dimensionOverrides.find(
                        (override) => override.dimensionId === dimension.dimensionId,
                    );
                    if (override) {
                        return { ...dimension, ...override };
                    }
                    return dimension;
                });
            }
            if (freeTrialEndDate || discount || dimensionOverrides) {
                this.overridesForOffering = new CustomOverrides({ freeTrialEndDate, discount, dimensionOverrides });
            }

            this.offeringEnrollmentDate = offeringEnrollmentDate;
            this.offering = offering;
            if (offeringResponseData) {
                this.readOfferingResponseData = offeringResponseData;
            }
            this.offeringId = offeringId;
            this.customerId = customerId;
        }
    }
}
export class ReadContractDto {
    customerId: string;
    businessID: string;
    offeringId?: string;
    // The below offering enrollment date, is a bit of a hack
    // Since today there are cases where we will not have a contract in the DB, the offering enrollment date exists on the customer object itself
    // So if we don't have a contract, we will use the offering enrollment date from the customer object
    offeringEnrollmentDate?: string;
    freeTrialEndDate?: string;
    constructor(fields: ReadContractDto) {
        if (fields) {
            const { customerId, businessID, offeringId, offeringEnrollmentDate, freeTrialEndDate } = fields;
            this.customerId = customerId;
            this.businessID = businessID;
            this.offeringId = offeringId;
            this.offeringEnrollmentDate = offeringEnrollmentDate;
            this.freeTrialEndDate = freeTrialEndDate;
        }
    }
}

export class CustomerEnrollmentResponseData {
    /**
     * The offering that the customer is enrolled in. The offering is a template for the customer's contract. Any customer specific changes to the offering are stored in the overrides object.
     *
     */
    public offering: ReadOfferingResponseData;
    /**
     *
     * The date time when a customer enrolled for an offering.
     * <br><br>
     * Example `"2020-12-30T23:59:59.999Z"`
     * @example "2020-12-30T23:59:59.999Z"
     */
    public offeringEnrollmentDate: string;

    /**
     * Overrides for the offering. Applies Customer specific overrides to the offering. Such as a discount or free trial.
     */
    public overrides?: CustomOverrides;
}
export class CustomerEnrollmentResponseDto extends BasicResponseDTO {
    /**
     * The data returned from the request. Can be empty, indicated that the customer is not enrolled in any offerings.
     */
    @ApiProperty({ type: CustomerEnrollmentResponseData, isArray: true, minimum: 0, maximum: 1 })
    public data: CustomerEnrollmentResponseData[];

    constructor(fields: CustomerEnrollmentResponseDto) {
        super();
        if (fields) {
            const { data, message } = fields;
            this.data = data;
            this.message = message;
        }
    }
}
