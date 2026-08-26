import {
    ValidationArguments,
    ValidationOptions,
    registerDecorator,
    ValidatorConstraint,
    ValidatorConstraintInterface,
} from 'class-validator';

@ValidatorConstraint({ name: 'ValidateFutureDateRule', async: false })
export class ValidateFutureDateRule implements ValidatorConstraintInterface {
    async validate(date: string) {
        if (date) {
            return new Date(date).getTime() > new Date().getTime();
        } else {
            return true;
        }
    }

    defaultMessage(args: ValidationArguments & { object: { freeTrialEndDate: string } }) {
        return `Date: ${args?.object
            ?.freeTrialEndDate} is not in the future. Must be less than right now UTC: ${new Date().toISOString()}`;
    }
}

export function ValidateFutureDate(property: string, validationOptions?: ValidationOptions) {
    return function (object: unknown, propertyName: string) {
        registerDecorator({
            name: 'ValidateFutureDate',
            target: object.constructor,
            propertyName: propertyName,
            constraints: [property],
            options: validationOptions,
            validator: ValidateFutureDateRule,
        });
    };
}
