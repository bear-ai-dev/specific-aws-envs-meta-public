import { Injectable } from '@nestjs/common';
import {
    ValidationArguments,
    ValidationOptions,
    registerDecorator,
    ValidatorConstraint,
    ValidatorConstraintInterface,
} from 'class-validator';
import { ServicesService } from '../services.service.js';

@ValidatorConstraint({ name: 'ServiceIdExistsRule', async: true })
@Injectable()
export class ServiceIdExistsRule implements ValidatorConstraintInterface {
    constructor(readonly servicesService: ServicesService) {}

    async validate(id: string, args: ValidationArguments) {
        if (id) {
            try {
                console.log(JSON.stringify(args));
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                await this.servicesService.findOne({ serviceId: id, businessID: args?.object?.businessID });
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
        return `serviceId: ${args.object?.serviceId} doesn't exist`;
    }
}

export function ServiceIdExists(property: string, validationOptions?: ValidationOptions) {
    return function (object: unknown, propertyName: string) {
        registerDecorator({
            name: 'serviceIdExists',
            target: object.constructor,
            propertyName: propertyName,
            constraints: [property],
            options: validationOptions,
            validator: ServiceIdExistsRule,
        });
    };
}
