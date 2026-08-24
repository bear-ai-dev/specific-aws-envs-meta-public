import {
    ValidationArguments,
    ValidationOptions,
    registerDecorator,
    ValidatorConstraint,
    ValidatorConstraintInterface,
} from 'class-validator';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
@ValidatorConstraint({ name: 'ValidatePastDateRule', async: false })
export class ValidatePastDateRule implements ValidatorConstraintInterface {
    async validate(date: string) {
        if (date) {
            return new Date(date).getTime() < new Date().getTime();
        } else {
            return true;
        }
    }

    defaultMessage(args: ValidationArguments & { object: { freeTrialStartDate: string } }) {
        return `Date: ${args?.object
            ?.freeTrialStartDate} is not in the past. Must be less than right now UTC: ${new Date().toISOString()}`;
    }
}

export function ValidatePastDate(property: string, validationOptions?: ValidationOptions) {
    return function (object: unknown, propertyName: string) {
        registerDecorator({
            name: 'ValidatePastDate',
            target: object.constructor,
            propertyName: propertyName,
            constraints: [property],
            options: validationOptions,
            validator: ValidatePastDateRule,
        });
    };
}
