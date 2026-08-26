import { forwardRef, Inject, Injectable } from '@nestjs/common';
import {
    ValidationArguments,
    ValidationOptions,
    registerDecorator,
    ValidatorConstraint,
    ValidatorConstraintInterface,
} from 'class-validator';
import { OfferingService } from '../offering.service.js';

@ValidatorConstraint({ name: 'OfferingIdExistsRule', async: true })
@Injectable()
export class OfferingIdExistsRule implements ValidatorConstraintInterface {
    constructor(@Inject(forwardRef(() => OfferingService)) readonly offeringService: OfferingService) {}

    async validate(id: string, args: ValidationArguments) {
        if (id) {
            try {
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                await this.offeringService.findOne({ offeringId: id, businessID: args?.object?.businessID });
                return true;
            } catch (e) {
                console.log(e);
                return false;
            }
        } else {
            return true;
        }
    }

    defaultMessage(args: ValidationArguments) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        return `offeringId: ${args.object?.offeringId} doesn't exist`;
    }
}

export function OfferingIdExists(property: string, validationOptions?: ValidationOptions) {
    return function (object: unknown, propertyName: string) {
        registerDecorator({
            name: 'OfferingIdExists',
            target: object.constructor,
            propertyName: propertyName,
            constraints: [property],
            options: validationOptions,
            validator: OfferingIdExistsRule,
        });
    };
}
