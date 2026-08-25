import { Injectable } from '@nestjs/common';
import {
    registerDecorator,
    ValidationArguments,
    ValidationOptions,
    ValidatorConstraint,
    ValidatorConstraintInterface,
} from 'class-validator';
import { OfferingType } from '../entities/OfferingType.js';
import { CreateOfferingDTO } from './createOffering.dto.js';

@ValidatorConstraint({ name: 'FreeTrialLengthRule', async: false })
@Injectable()
export class FreeTrialLengthRule implements ValidatorConstraintInterface {
    validate(freeTrialLength: string, args: ValidationArguments) {
        const offeringType = (args.object as CreateOfferingDTO).offeringType;
        if (freeTrialLength === undefined) {
            return true;
        }
        if (offeringType && offeringType === OfferingType.subscription) {
            return freeTrialLength === '0' || freeTrialLength === '1';
        }
        if (offeringType && offeringType === OfferingType.usageBased) {
            return true;
        }
        return false;
    }

    defaultMessage() {
        return 'If offeringType is subscription, FreeTrialLength cannot be greater than 1';
    }
}

export function FreeTrialLength(property: string, validationOptions?: ValidationOptions) {
    return function (object: unknown, propertyName: string) {
        registerDecorator({
            name: 'FreeTrialLength',
            target: object.constructor,
            propertyName: propertyName,
            constraints: [property],
            options: validationOptions,
            validator: FreeTrialLengthRule,
        });
    };
}
