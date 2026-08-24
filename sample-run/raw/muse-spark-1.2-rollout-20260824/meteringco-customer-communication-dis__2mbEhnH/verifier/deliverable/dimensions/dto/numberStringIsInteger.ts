import { Injectable } from '@nestjs/common';
import {
    ValidationArguments,
    ValidationOptions,
    registerDecorator,
    ValidatorConstraint,
    ValidatorConstraintInterface,
} from 'class-validator';

@ValidatorConstraint({ name: 'NumberStringIsIntegerRule', async: true })
@Injectable()
export class NumberStringIsIntegerRule implements ValidatorConstraintInterface {
    async validate(usageIncrement: string) {
        if (usageIncrement) {
            return Number.isInteger(Number(usageIncrement));
        } else {
            return false;
        }
    }

    defaultMessage(args: ValidationArguments) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        return `usageIncrement: ${args.object?.usageIncrement} is not an integer`;
    }
}

export function NumberStringIsInteger(property: string, validationOptions?: ValidationOptions) {
    return function (object: unknown, propertyName: string) {
        registerDecorator({
            name: 'NumberStringIsInteger',
            target: object.constructor,
            propertyName: propertyName,
            constraints: [property],
            options: validationOptions,
            validator: NumberStringIsIntegerRule,
        });
    };
}
