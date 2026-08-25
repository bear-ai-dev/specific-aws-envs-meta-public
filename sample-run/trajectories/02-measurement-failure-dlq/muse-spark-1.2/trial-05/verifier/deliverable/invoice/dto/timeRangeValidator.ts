import { Injectable } from '@nestjs/common';
import {
    ValidationArguments,
    ValidationOptions,
    registerDecorator,
    ValidatorConstraint,
    ValidatorConstraintInterface,
} from 'class-validator';
import { getFirstDayOfCurrentMonthUTC } from '../../utils/shared/dateFormating.js';

@ValidatorConstraint({ name: 'StartTimeRangeValidationRule', async: false })
@Injectable()
export class StartTimeRangeValidationRule implements ValidatorConstraintInterface {
    validate(start: string, args: ValidationArguments) {
        if (start) {
            try {
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                const endTime = args?.object?.end;
                const startTimeDate = new Date(start);
                if (endTime) {
                    const endTimeDate = new Date(endTime);

                    if (
                        startTimeDate.getTime() > endTimeDate.getTime() ||
                        startTimeDate.getTime() === endTimeDate.getTime()
                    ) {
                        return false;
                    }
                } else {
                    const endTimeDate = new Date();
                    if (startTimeDate.getTime() > endTimeDate.getTime()) {
                        return false;
                    }
                }
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
        return `start: ${args.object?.start} must be before end: ${
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            args.object?.end ? args.object?.end : new Date().toISOString()
        }`;
    }
}

export function StartTimeRangeValidation(property: string, validationOptions?: ValidationOptions) {
    return function (object: unknown, propertyName: string) {
        registerDecorator({
            name: 'StartTimeRangeValidation',
            target: object.constructor,
            propertyName: propertyName,
            constraints: [property],
            options: validationOptions,
            validator: StartTimeRangeValidationRule,
        });
    };
}
