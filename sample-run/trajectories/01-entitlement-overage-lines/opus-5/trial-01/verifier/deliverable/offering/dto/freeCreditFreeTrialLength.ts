import { Injectable } from '@nestjs/common';
import {
    registerDecorator,
    ValidationArguments,
    ValidationOptions,
    ValidatorConstraint,
    ValidatorConstraintInterface,
} from 'class-validator';

import { CreateOfferingDTO } from './createOffering.dto.js';

@ValidatorConstraint({ name: 'FreeTrialAndCreditRule', async: false })
@Injectable()
export class FreeTrialAndCreditRule implements ValidatorConstraintInterface {
    validate(freeTrialLength: string, args: ValidationArguments) {
        const credit = (args.object as CreateOfferingDTO).prepaidCredit;

        if (freeTrialLength && credit) {
            return false;
        }

        return true;
    }

    defaultMessage() {
        return 'Free credit and a free trial cannot exist on the same offering';
    }
}

export function FreeTrialAndCredit(property: string, validationOptions?: ValidationOptions) {
    return function (object: unknown, propertyName: string) {
        registerDecorator({
            name: 'freeTrialAndCredit',
            target: object.constructor,
            propertyName: propertyName,
            constraints: [property],
            options: validationOptions,
            validator: FreeTrialAndCreditRule,
        });
    };
}
