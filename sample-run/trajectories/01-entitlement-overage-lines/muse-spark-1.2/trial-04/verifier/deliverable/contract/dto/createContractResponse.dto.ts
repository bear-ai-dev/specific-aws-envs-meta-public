import { IntersectionType } from '@nestjs/swagger';
import { CreateContractDto } from './createContract.dto';
import { BasicResponseDTO } from '../../basicResponseDTO';
import { PrepareContractResponseDto } from './prepareContractResponse.dto';

export class CreateContractResponseDto extends IntersectionType(PrepareContractResponseDto, BasicResponseDTO) {
    constructor(fields: CreateContractResponseDto) {
        if (fields) {
            super();
            const {
                customerId,
                businessID,
                offeringId,
                overridesForOffering,
                offering,
                prepaidCredit,
                readOfferingResponseData,
                offeringEnrollmentDate,
            } = fields;
            this.customerId = customerId;
            this.businessID = businessID;
            if (overridesForOffering) {
                this.overridesForOffering = overridesForOffering;
            }
            if (prepaidCredit) {
                this.prepaidCredit = prepaidCredit;
            }
            if (offeringId) {
                this.offeringId = offeringId;
            }

            if (offering) {
                this.offering = offering;
            }
            this.offeringEnrollmentDate = offeringEnrollmentDate;
            this.readOfferingResponseData = readOfferingResponseData;
            this.message = fields?.message;
        }
    }
}
