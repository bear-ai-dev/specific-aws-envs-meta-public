import { Injectable } from '@nestjs/common';
import {
    ValidationArguments,
    ValidationOptions,
    registerDecorator,
    ValidatorConstraint,
    ValidatorConstraintInterface,
} from 'class-validator';
import { DimensionsService } from '../dimensions.service.js';

@ValidatorConstraint({ name: 'DimensionIdExistsRule', async: true })
@Injectable()
export class DimensionIdExistsRule implements ValidatorConstraintInterface {
    constructor(readonly dimensionService: DimensionsService) {}

    async validate(id: string, args: ValidationArguments) {
        if (id) {
            try {
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                await this.dimensionService.findOne({ dimensionId: id, businessID: args?.object?.businessID });
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
        return `dimensionId: ${args.object?.dimensionId} doesn't exist`;
    }
}

export function DimensionIdExists(property: string, validationOptions?: ValidationOptions) {
    return function (object: unknown, propertyName: string) {
        registerDecorator({
            name: 'DimensionIdExists',
            target: object.constructor,
            propertyName: propertyName,
            constraints: [property],
            options: validationOptions,
            validator: DimensionIdExistsRule,
        });
    };
}
