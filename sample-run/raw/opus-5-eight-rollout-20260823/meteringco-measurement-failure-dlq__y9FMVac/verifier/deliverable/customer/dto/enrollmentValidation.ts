import {
    ValidationArguments,
    ValidationOptions,
    registerDecorator,
    ValidatorConstraint,
    ValidatorConstraintInterface,
} from 'class-validator';
import { UpdateCustomerDto } from './update-customer.dto';
import { UpdateCustomerEnrollmentDto } from './updateCustomerEnrollment.dto';

@ValidatorConstraint({ name: 'ValidateUnenrollmentCaseRule', async: false })
export class ValidateUnenrollmentCaseRule implements ValidatorConstraintInterface {
    async validate(id, arg: ValidationArguments & { object: UpdateCustomerDto | UpdateCustomerEnrollmentDto }) {
        const dto = arg?.object;
        if (id && (dto?.removePriorOffering || dto?.offeringId)) {
            return false;
        } else {
            return true;
        }
    }

    defaultMessage(args: ValidationArguments) {
        return `Cannot have both unenrollOffering and removePriorOffering or offeringId set at the same time. Seperate the operations into multiple requests`;
    }
}

export function ValidateUnenrollmentCase(property: string, validationOptions?: ValidationOptions) {
    return function (object: unknown, propertyName: string) {
        registerDecorator({
            name: 'ValidateUnenrollmentCase',
            target: object.constructor,
            propertyName: propertyName,
            constraints: [property],
            options: validationOptions,
            validator: ValidateUnenrollmentCaseRule,
        });
    };
}
