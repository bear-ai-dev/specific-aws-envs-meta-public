import { Injectable } from '@nestjs/common';
import {
    registerDecorator,
    ValidationArguments,
    ValidationOptions,
    ValidatorConstraint,
    ValidatorConstraintInterface,
} from 'class-validator';
import { InvoiceLineItem } from '../entities/invoice.entity.js';

@ValidatorConstraint({ name: 'ManualInvoiceValidationRule', async: false })
@Injectable()
export class ManualInvoiceValidationRule implements ValidatorConstraintInterface {
    validate(lineItems: Array<any>, args: ValidationArguments) {
        if (!lineItems) {
            try {
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                if (args?.object?.start || args?.object?.end) {
                    return true;
                }
            } catch (e) {
                console.log(e);
                return false;
            }
        } else {
            if (Array.isArray(lineItems)) {
                return true;
            } else {
                return false;
            }
        }
    }

    defaultMessage() {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        return `items must be an Array and if items is not provided start or end must be provided`;
    }
}

export function ManualInvoiceValidation(property: string, validationOptions?: ValidationOptions) {
    return function (object: unknown, propertyName: string) {
        registerDecorator({
            name: 'ManualInvoiceValidation',
            target: object.constructor,
            propertyName: propertyName,
            constraints: [property],
            options: validationOptions,
            validator: ManualInvoiceValidationRule,
        });
    };
}

@ValidatorConstraint({ name: 'InvoiceLineItemValidationRule', async: false })
@Injectable()
export class InvoiceLineItemValidationRule implements ValidatorConstraintInterface {
    validate(lineItems: Array<any>) {
        if (!lineItems) {
            return true;
        } else {
            if (Array.isArray(lineItems)) {
                const lineItemArgs = lineItems as InvoiceLineItem[];
                const checks = lineItemArgs.map((lineItemTest) => {
                    if (lineItemTest?.unitCost === 0) {
                        return true;
                    }
                    if (lineItemTest?.unitCost) {
                        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                        // @ts-ignore
                        const decimalPlaces = lineItemTest.unitCost.toString().split('.')[1]?.length;
                        if (decimalPlaces) {
                            const assignedValue = decimalPlaces <= 8;
                            return assignedValue;
                        } else {
                            // number doesn't have a decimal place so it's valid
                            return true;
                        }
                    } else {
                        return false;
                    }
                });
                return checks.every((check) => check === true);
            }
        }
    }

    defaultMessage() {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        return `unitCost can only have 8 digits of precision.`;
    }
}

export function InvoiceLineItemValidation(property: string, validationOptions?: ValidationOptions) {
    return function (object: unknown, propertyName: string) {
        registerDecorator({
            name: 'InvoiceLineItemValidationRule',
            target: object.constructor,
            propertyName: propertyName,
            constraints: [property],
            options: validationOptions,
            validator: InvoiceLineItemValidationRule,
        });
    };
}
