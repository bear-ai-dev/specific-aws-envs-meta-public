import {
    ValidationArguments,
    ValidationOptions,
    registerDecorator,
    ValidatorConstraint,
    ValidatorConstraintInterface,
} from 'class-validator';

@ValidatorConstraint({ name: 'ValidateDecimalPlaces', async: false })
export class ValidateDecimalPlaceRule implements ValidatorConstraintInterface {
    async validate(consumptionPrice: string) {
        if (consumptionPrice) {
            const decimalPlaces = consumptionPrice.split('.')[1]?.length;
            if (decimalPlaces) {
                return decimalPlaces <= 8;
            } else {
                return true;
            }
        } else {
            return true;
        }
    }

    defaultMessage(args: ValidationArguments) {
        return `Price fields cannot have more than 8 digits of precision after decimal place`;
    }
}

export function ValidateDecimalPlace(property: string, validationOptions?: ValidationOptions) {
    return function (object: unknown, propertyName: string) {
        registerDecorator({
            name: 'ValidateDecimalPlace',
            target: object.constructor,
            propertyName: propertyName,
            constraints: [property],
            options: validationOptions,
            validator: ValidateDecimalPlaceRule,
        });
    };
}
