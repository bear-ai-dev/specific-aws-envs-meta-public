import { Point } from '@influxdata/influxdb-client';
import { ContractInfluxRow } from '../../influx/entities/contractInfluxRow';
import { InfluxService } from '../../influx/influx.service';
import { Offering } from '../../offering/entities/offeringPackage.entity';
import { CreateContractDto } from '../dto/createContract.dto';
import { CustomerContractDiscount } from '../dto/customerContractDiscount';
import { DimensionOverridesDto } from '../dto/dimensionOverrides.dto';

export class ContractEntity {
    public static _measurement = 'customerContract';
    public offering?: Offering;
    public discount?: CustomerContractDiscount;
    public offeringEnrollmentDate: string;
    public dimensionOverrides?: DimensionOverridesDto[];
    public freeTrialEndDate?: string;
    public customerId: string;
    public businessID: string;
    public offeringId?: string;
    public softDelete?: boolean;

    constructor(
        offering: Offering,
        contractDto: {
            customerId: string;
            offeringId: string;
            discount?: CustomerContractDiscount;
            businessID: string;
            freeTrialEndDate?: string;
            offeringEnrollmentDate: string;
            dimensionOverrides?: DimensionOverridesDto[];
        },
        softDelete?: boolean,
    ) {
        this.offering = offering;
        this.discount = contractDto.discount;
        this.customerId = contractDto.customerId;
        this.offeringId = contractDto.offeringId;
        this.businessID = contractDto.businessID;
        this.freeTrialEndDate = contractDto.freeTrialEndDate;
        this.offeringEnrollmentDate = contractDto.offeringEnrollmentDate;
        this.dimensionOverrides = contractDto.dimensionOverrides;
        this.softDelete = softDelete;
    }

    public static transformer(contractEntity: ContractEntity, influxService: InfluxService): Point[] {
        const contractEntityPoint = influxService.getPoint(ContractEntity._measurement);
        contractEntityPoint.tag('customerId', contractEntity.customerId);
        contractEntityPoint.tag('businessID', contractEntity.businessID);
        contractEntityPoint.stringField('customerId', contractEntity.customerId);
        if (contractEntity?.offeringId) {
            contractEntityPoint.tag('offeringId', contractEntity.offeringId);
        }
        if (contractEntity?.discount) {
            contractEntityPoint.tag('discountName', contractEntity.discount.name);
            contractEntityPoint.tag('discountPercentage', contractEntity.discount.percentage);
            if (contractEntity.discount.endDate) {
                contractEntityPoint.tag('discountEndDate', contractEntity.discount.endDate);
            }
        }
        if (contractEntity?.freeTrialEndDate) {
            contractEntityPoint.tag('freeTrialEndDate', contractEntity.freeTrialEndDate);
        }
        if (contractEntity?.offeringEnrollmentDate) {
            contractEntityPoint.tag('offeringEnrollmentDate', contractEntity.offeringEnrollmentDate);
        }
        if (contractEntity?.dimensionOverrides && contractEntity?.dimensionOverrides?.length > 0) {
            contractEntityPoint.tag('dimensionOverrides', JSON.stringify(contractEntity.dimensionOverrides));
        }
        if (contractEntity?.softDelete) {
            contractEntityPoint.tag('softDelete', 'deleted');
        }
        return [contractEntityPoint];
    }
    public static dbModelToEntity(dbModel: ContractInfluxRow, offering?: Offering): ContractEntity {
        const {
            customerId,
            offeringId,
            discountEndDate,
            discountName,
            discountPercentage,
            offeringEnrollmentDate,
            freeTrialEndDate,
            businessID,
            dimensionOverrides,
        } = dbModel;
        let discount: CustomerContractDiscount | undefined;
        if (discountName || discountPercentage) {
            discount = new CustomerContractDiscount({
                name: discountName,
                percentage: discountPercentage,
                endDate: discountEndDate,
            });
        }
        let dimensionOverridesDto: DimensionOverridesDto[] | undefined;
        if (dimensionOverrides) {
            dimensionOverridesDto = JSON.parse(dimensionOverrides);
        }
        return new ContractEntity(offering, {
            discount,
            customerId,
            offeringId,
            businessID,
            offeringEnrollmentDate,
            freeTrialEndDate,
            dimensionOverrides: dimensionOverridesDto,
        });
    }
}
