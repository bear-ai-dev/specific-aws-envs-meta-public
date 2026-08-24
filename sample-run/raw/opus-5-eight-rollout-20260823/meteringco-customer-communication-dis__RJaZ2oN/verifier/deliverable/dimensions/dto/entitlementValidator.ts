import { Injectable } from '@nestjs/common';
import {
    ValidationArguments,
    ValidationOptions,
    registerDecorator,
    ValidatorConstraint,
    ValidatorConstraintInterface,
} from 'class-validator';
import { overageAllowedEnum } from './create-dimension.dto.js';
import { CreateDimensionDto } from './create-dimension.dto.js';

@ValidatorConstraint({ name: 'EntitlementMustBeSetRule', async: false })
@Injectable()
export class EntitlementMustBeSetRule implements ValidatorConstraintInterface {
    validate(overageAllowed: overageAllowedEnum, args: ValidationArguments) {
        const entitlement = (args.object as CreateDimensionDto).usageEntitlement;
        const tiers = (args.object as CreateDimensionDto).tiers;
        if (overageAllowed === undefined) {
            return true;
        }
        if (overageAllowedEnum.false === overageAllowed && entitlement !== undefined) {
            return true;
        }
        if (overageAllowed === overageAllowedEnum.true && tiers && tiers.length) {
            return true;
        }
        return entitlement !== 'inf' && overageAllowed === overageAllowedEnum.true && entitlement !== undefined;
    }

    defaultMessage() {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        return 'Entitlment cannot be inf or undefined with overage set to true unless tiers are set.';
    }
}

export function EntitlementMustBeSet(property: string, validationOptions?: ValidationOptions) {
    return function (object: unknown, propertyName: string) {
        registerDecorator({
            name: 'OverageAllowed',
            target: object.constructor,
            propertyName: propertyName,
            constraints: [property],
            options: validationOptions,
            validator: EntitlementMustBeSetRule,
        });
    };
}

@ValidatorConstraint({ name: 'EntitlementCanbeInf', async: false })
@Injectable()
export class EntitlementCanbeInfRule implements ValidatorConstraintInterface {
    validate(usageEntitlement?: number | 'inf') {
        if (usageEntitlement === undefined) {
            return true;
        }
        if (usageEntitlement === 'inf') {
            return true;
        }
        if (Number.isInteger(usageEntitlement)) {
            return true;
        }
        return false;
    }

    defaultMessage() {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        return 'Entitlement can be either a number or the string "inf".';
    }
}

export function EntitlementCanbeInf(property: string, validationOptions?: ValidationOptions) {
    return function (object: unknown, propertyName: string) {
        registerDecorator({
            name: 'EntitlementCanbeInfRule',
            target: object.constructor,
            propertyName: propertyName,
            constraints: [property],
            options: validationOptions,
            validator: EntitlementCanbeInfRule,
        });
    };
}

@ValidatorConstraint({ name: 'ShouldSetConsumptionPrice', async: false })
@Injectable()
export class ShouldSetConsumptionPriceRule implements ValidatorConstraintInterface {
    validate(consumptionPrice: string, args: ValidationArguments) {
        const entitlement = (args.object as CreateDimensionDto)?.usageEntitlement;
        const overageAllowed = (args.object as CreateDimensionDto)?.overageAllowed;
        const tiers = (args.object as CreateDimensionDto)?.tiers;
        const tiersGroupByMetadata = (args.object as CreateDimensionDto)?.tiersGroupByMetadata;
        if (tiers && tiers?.length) {
            return true;
        }

        if (tiersGroupByMetadata && tiersGroupByMetadata?.length) {
            return true;
        }
        if (entitlement === undefined || entitlement === null) {
            if (
                consumptionPrice &&
                typeof consumptionPrice === 'string' &&
                // Type coersion is needed here because the type of consumptionPrice is string: https://stackoverflow.com/questions/175739/how-can-i-check-if-a-string-is-a-valid-number
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                !isNaN(consumptionPrice) &&
                !isNaN(parseFloat(consumptionPrice))
            ) {
                return true;
            } else {
                return false;
            }
        }
        if (entitlement !== undefined && entitlement !== null && overageAllowed === overageAllowedEnum.true) {
            if (
                consumptionPrice &&
                typeof consumptionPrice === 'string' &&
                // Type coersion is needed here because the type of consumptionPrice is string: https://stackoverflow.com/questions/175739/how-can-i-check-if-a-string-is-a-valid-number
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                !isNaN(consumptionPrice) &&
                !isNaN(parseFloat(consumptionPrice))
            ) {
                return true;
            } else {
                return false;
            }
        } else if (
            ((overageAllowed === overageAllowedEnum.false || overageAllowed === null || overageAllowed === undefined) &&
                entitlement !== undefined) ||
            entitlement !== null
        ) {
            if (consumptionPrice) {
                return false;
            } else {
                return true;
            }
        } else {
            return false;
        }
    }

    defaultMessage(args: ValidationArguments) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        return `Consumption price should be set as a numeric string if overage is allowed and usage entitlement is set. If there is no entitlement consumption price should also be set. If there is an entitlement and overage is not allowed, consumption price should not be set. Value: ${args.object?.consumptionPrice} is incorrect given: overageAllowed: ${args.object?.overageAllowed} and usageEntitlement: ${args.object?.usageEntitlement}`;
    }
}

export function ShouldSetConsumptionPrice(property: string, validationOptions?: ValidationOptions) {
    return function (object: unknown, propertyName: string) {
        registerDecorator({
            name: 'ShouldSetConsumptionPrice',
            target: object.constructor,
            propertyName: propertyName,
            constraints: [property],
            options: validationOptions,
            validator: ShouldSetConsumptionPriceRule,
        });
    };
}
