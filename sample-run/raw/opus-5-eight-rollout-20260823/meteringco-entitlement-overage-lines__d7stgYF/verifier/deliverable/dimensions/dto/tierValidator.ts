import { Injectable } from '@nestjs/common';
import {
    ValidationArguments,
    ValidationOptions,
    ValidatorConstraint,
    ValidatorConstraintInterface,
    registerDecorator,
} from 'class-validator';
import { overageAllowedEnum, CreateDimensionDto } from './create-dimension.dto.js';

import { DimensionTierDto } from './dimensionTier.dto';

@ValidatorConstraint({ name: 'TierExclusiveValidatorRule', async: false })
@Injectable()
export class TierExclusiveValidatorRule implements ValidatorConstraintInterface {
    validate(tiers: DimensionTierDto[], args: ValidationArguments) {
        const entitlement = (args.object as CreateDimensionDto)?.usageEntitlement;
        const overage = (args.object as CreateDimensionDto)?.overageAllowed;
        const consumptionPrice = (args.object as CreateDimensionDto)?.consumptionPrice;
        if (!tiers) {
            return true;
        }
        if (tiers && tiers.length) {
            if (entitlement || consumptionPrice) {
                return false;
            }
            if (overage === overageAllowedEnum.true) {
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
        return `If tiers are set then entitlement, consumptionPrice, and overageAllowed must not be set`;
    }
}

export function TierEntitlementValidator(property: string, validationOptions?: ValidationOptions) {
    return function (object: unknown, propertyName: string) {
        registerDecorator({
            name: 'TierExclusiveValidatorRule',
            target: object.constructor,
            propertyName: propertyName,
            constraints: [property],
            options: validationOptions,
            validator: TierExclusiveValidatorRule,
        });
    };
}

@ValidatorConstraint({ name: 'TierUnitPriceValidatorRule', async: false })
@Injectable()
export class TierUnitPriceValidatorRule implements ValidatorConstraintInterface {
    validate(tiers: DimensionTierDto[], args: ValidationArguments) {
        if (!tiers) {
            return true;
        }
        if (tiers && tiers.length) {
            const [firstTier, ...rest] = tiers;
            const res = rest.find((tier) => tier?.unitPrice === undefined || tier?.unitPrice === null);
            return res === undefined;
        } else {
            return true;
        }
    }

    defaultMessage(args: ValidationArguments) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        return `unitPrice must be set for all tiers, besides the first tier if entitlement is set`;
    }
}

export function TierUnitPriceValidator(property: string, validationOptions?: ValidationOptions) {
    return function (object: unknown, propertyName: string) {
        registerDecorator({
            name: 'TierUnitPriceValidatorRule',
            target: object.constructor,
            propertyName: propertyName,
            constraints: [property],
            options: validationOptions,
            validator: TierUnitPriceValidatorRule,
        });
    };
}

@ValidatorConstraint({ name: 'TierUsageIncrementCheckerRule', async: false })
@Injectable()
export class TierUsageIncrementCheckerRule implements ValidatorConstraintInterface {
    validate(tiers: DimensionTierDto[], args: ValidationArguments) {
        const increment = (args.object as CreateDimensionDto)?.usageIncrement;

        if (!tiers) {
            return true;
        }
        if (tiers && tiers.length) {
            const [firstTier, ...rest] = tiers;
            const filteredForInf = rest.filter((tier) => tier?.upperBound !== 'inf');
            const res = filteredForInf.find((tier) => parseFloat(tier?.upperBound) % parseFloat(increment) !== 0);
            return res === undefined;
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

export function TierUsageIncrementCheckerValidator(property: string, validationOptions?: ValidationOptions) {
    return function (object: unknown, propertyName: string) {
        registerDecorator({
            name: 'TierUsageIncrementCheckerRule',
            target: object.constructor,
            propertyName: propertyName,
            constraints: [property],
            options: validationOptions,
            validator: TierUsageIncrementCheckerRule,
        });
    };
}

@ValidatorConstraint({ name: 'NumberStringCanbeInf', async: false })
@Injectable()
export class NumberStringCanbeInfRule implements ValidatorConstraintInterface {
    validate(field?: string | 'inf') {
        if (field === undefined) {
            return true;
        }
        if (field === 'inf') {
            return true;
        }
        if (Number.isInteger(Number(field))) {
            return true;
        }
        return false;
    }

    defaultMessage(args: ValidationArguments) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        return `${args?.property} can be either a number or the string "inf".`;
    }
}

export function NumberStringCanbeInf(property: string, validationOptions?: ValidationOptions) {
    return function (object: unknown, propertyName: string) {
        registerDecorator({
            name: 'NumberStringCanbeInfRule',
            target: object.constructor,
            propertyName: propertyName,
            constraints: [property],
            options: validationOptions,
            validator: NumberStringCanbeInfRule,
        });
    };
}

@ValidatorConstraint({ name: 'TiersCannotOverlapRule', async: false })
@Injectable()
export class TiersCannotOverlapRule implements ValidatorConstraintInterface {
    validate(tiers: DimensionTierDto[], args: ValidationArguments) {
        if (tiers === undefined || tiers === null) {
            return true;
        }
        if (tiers && tiers?.length === 0) {
            return true;
        }
        // Sort the tiers by tierPosition
        const sortedTiers = tiers.sort((a, b) => parseInt(a.tierPosition) - parseInt(b.tierPosition));
        // Confirm that the upperBound of each tier is less than the upperBound of the next tier
        // If the upperBound of the next tier is 'inf', then the upperBound of the current tier must not be 'inf'
        const res = sortedTiers.find((tier, index) => {
            if (index === sortedTiers.length - 1) {
                return false;
            }
            const nextTier = sortedTiers[index + 1];
            if (nextTier?.upperBound === 'inf') {
                return tier?.upperBound === 'inf';
            }
            return parseFloat(tier?.upperBound) >= parseFloat(nextTier?.upperBound);
        });
        return res === undefined;
    }

    defaultMessage(args: ValidationArguments) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        return `Tiers cannot overlap`;
    }
}

export function TiersCannotOverlapValidator(property: string, validationOptions?: ValidationOptions) {
    return function (object: unknown, propertyName: string) {
        registerDecorator({
            name: 'TiersCannotOverlapRule',
            target: object.constructor,
            propertyName: propertyName,
            constraints: [property],
            options: validationOptions,
            validator: TiersCannotOverlapRule,
        });
    };
}
