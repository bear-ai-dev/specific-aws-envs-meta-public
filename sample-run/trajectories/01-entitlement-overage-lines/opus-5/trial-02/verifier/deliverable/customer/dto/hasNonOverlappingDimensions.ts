import {
    ValidationArguments,
    ValidationOptions,
    registerDecorator,
    ValidatorConstraint,
    ValidatorConstraintInterface,
} from 'class-validator';
import { CreateUsageDto } from '../../usage/dto/create-usage.dto';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
@ValidatorConstraint({ name: 'ValidateUniqueDimensions', async: false })
export class ValidateUniqueDimensionsRule implements ValidatorConstraintInterface {
    async validate(usage: CreateUsageDto[]) {
        if (usage && Array.isArray(usage) && usage.length > 0) {
            const dimensionIds = usage.map((u) => u.dimensionId);
            const uniqueDimensionIds = [...new Set(dimensionIds)];
            return dimensionIds.length === uniqueDimensionIds.length;
        } else {
            return true;
        }
    }

    defaultMessage(args: ValidationArguments & { object: { freeTrialStartDate: string } }) {
        return `Cannot have duplicate usage events for the same dimensionId`;
    }
}

export function ValidateUniqueDimensions(property: string, validationOptions?: ValidationOptions) {
    return function (object: unknown, propertyName: string) {
        registerDecorator({
            name: 'ValidateUniqueDimensions',
            target: object.constructor,
            propertyName: propertyName,
            constraints: [property],
            options: validationOptions,
            validator: ValidateUniqueDimensionsRule,
        });
    };
}
