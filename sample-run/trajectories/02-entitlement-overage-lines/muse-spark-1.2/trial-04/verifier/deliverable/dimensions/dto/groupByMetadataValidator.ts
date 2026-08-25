import { Injectable } from '@nestjs/common';
import {
    ValidationArguments,
    ValidationOptions,
    ValidatorConstraint,
    ValidatorConstraintInterface,
    registerDecorator,
} from 'class-validator';
import { DimensionTiersGroupByMetadataDto } from './dimensionTiersGroupByMetadataDto.dto';
import { CreateDimensionDto, PaymentSchedule, overageAllowedEnum } from './create-dimension.dto';

@ValidatorConstraint({ name: 'ConsistentMetadataKeysRule', async: false })
@Injectable()
export class ConsistentMetadataKeysRule implements ValidatorConstraintInterface {
    validate(groupedByMetadataTiers: DimensionTiersGroupByMetadataDto[], args: ValidationArguments) {
        if (!groupedByMetadataTiers) {
            return true;
        }
        if (Array.isArray(groupedByMetadataTiers)) {
            if (groupedByMetadataTiers.length === 0) {
                return true;
            } else {
                const setOfKeys = new Set<string>();
                Object.keys(groupedByMetadataTiers[0].metadataGroups).forEach((key) => {
                    setOfKeys.add(key);
                });
                let allKeysMatch = true;
                groupedByMetadataTiers?.forEach((tier) => {
                    Object.keys(tier.metadataGroups).forEach((key) => {
                        if (!setOfKeys.has(key)) {
                            allKeysMatch = false;
                        }
                    });
                });
                return allKeysMatch;
            }
        } else {
            return true;
        }
    }

    defaultMessage(args: ValidationArguments) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        return `All metadata keys must be consistent across all tiers`;
    }
}

export function ConsistentMetadataKeys(property: string, validationOptions?: ValidationOptions) {
    return function (object: unknown, propertyName: string) {
        registerDecorator({
            name: 'ConsistentMetadataKeysRule',
            target: object.constructor,
            propertyName: propertyName,
            constraints: [property],
            options: validationOptions,
            validator: ConsistentMetadataKeysRule,
        });
    };
}

@ValidatorConstraint({ name: 'GroupByMetadataTierIncrementValidatorRule', async: false })
@Injectable()
export class GroupByMetadataTierIncrementValidatorRule implements ValidatorConstraintInterface {
    validate(groupedByMetadataTiers: DimensionTiersGroupByMetadataDto[], args: ValidationArguments) {
        const increment = (args.object as CreateDimensionDto)?.usageIncrement;
        if (!groupedByMetadataTiers) {
            return true;
        }
        if (Array.isArray(groupedByMetadataTiers) && groupedByMetadataTiers.length) {
            const value = groupedByMetadataTiers.find((group) => {
                const tiers = group?.tiers;
                if (tiers && tiers.length) {
                    const [firstTier, ...rest] = tiers;
                    const filteredForInf = rest.filter((tier) => tier?.upperBound !== 'inf');
                    const res = filteredForInf.find(
                        (tier) => parseFloat(tier?.upperBound) % parseFloat(increment) !== 0,
                    );
                    return res;
                } else {
                    return false;
                }
            });
            return Boolean(!value);
        } else {
            return true;
        }
    }

    defaultMessage(args: ValidationArguments) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        return `bounds for tiers must be a multiple of the usageIncrement`;
    }
}

export function GroupByMetadataTierIncrementValidator(property: string, validationOptions?: ValidationOptions) {
    return function (object: unknown, propertyName: string) {
        registerDecorator({
            name: 'GroupByMetadataTierValidatorRule',
            target: object.constructor,
            propertyName: propertyName,
            constraints: [property],
            options: validationOptions,
            validator: GroupByMetadataTierIncrementValidatorRule,
        });
    };
}
@ValidatorConstraint({ name: 'GroupedTierExclusiveValidatorRule', async: false })
@Injectable()
export class GroupedTierExclusiveValidatorRule implements ValidatorConstraintInterface {
    validate(groupedTiers: DimensionTiersGroupByMetadataDto[], args: ValidationArguments) {
        const entitlement = (args.object as CreateDimensionDto)?.usageEntitlement;
        const overage = (args.object as CreateDimensionDto)?.overageAllowed;
        const consumptionPrice = (args.object as CreateDimensionDto)?.consumptionPrice;
        const tiers = (args.object as CreateDimensionDto)?.tiers;
        const paymentSchedulearg = (args.object as CreateDimensionDto)?.paymentSchedule;
        if (!groupedTiers) {
            return true;
        }
        if (groupedTiers && groupedTiers.length) {
            if (entitlement || consumptionPrice) {
                return false;
            }
            if (tiers && tiers.length) {
                return false;
            }
            if (overage === overageAllowedEnum.true) {
                return false;
            }
            if (paymentSchedulearg && paymentSchedulearg !== PaymentSchedule.arrear) {
                return false;
            }
            return true;
        } else {
            return true;
        }
    }

    defaultMessage(args: ValidationArguments) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        return `If tiersGroupedByMetadata are set then entitlement, consumptionPrice, overageAllowed, tiers must not be set, additionally, payment schedule must be undefined or arrear`;
    }
}

export function GroupedTierExclusiveValidator(property: string, validationOptions?: ValidationOptions) {
    return function (object: unknown, propertyName: string) {
        registerDecorator({
            name: 'GroupedTierExclusiveValidatorRule',
            target: object.constructor,
            propertyName: propertyName,
            constraints: [property],
            options: validationOptions,
            validator: GroupedTierExclusiveValidatorRule,
        });
    };
}
