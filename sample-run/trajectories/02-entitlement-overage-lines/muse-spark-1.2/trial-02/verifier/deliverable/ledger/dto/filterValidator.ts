import {
    ValidationArguments,
    ValidationOptions,
    registerDecorator,
    ValidatorConstraint,
    ValidatorConstraintInterface,
} from 'class-validator';
import { ReadLedgerDto } from './readLedger.dto';
import { ALLOWED_FILTERS } from './allowedLedgerFilters';

@ValidatorConstraint({ name: 'ValidateFiltersRule', async: false })
export class ValidateFiltersRule implements ValidatorConstraintInterface {
    async validate(filters: Record<string, string>[], arg: ValidationArguments & { object: ReadLedgerDto }) {
        const type = arg?.object?.type;
        if (!type) {
            return true;
        }
        const validFilterObj = ALLOWED_FILTERS[type];
        const filterKeys = Object.keys(filters);
        if (filterKeys && filterKeys.length > 0) {
            for (const filter of filterKeys) {
                const filterSet = validFilterObj[filter];
                if (!filterSet) {
                    return false;
                }
                if (
                    Array.isArray(filterSet) &&
                    !Array.isArray(filters[filter]) &&
                    !filterSet.includes(filters[filter])
                ) {
                    return false;
                }
                if (Array.isArray(filterSet) && Array.isArray(filters[filter])) {
                    for (const filterValue of filters[filter]) {
                        if (!filterSet.includes(filterValue)) {
                            return false;
                        }
                    }
                }
            }
        }
        return true;
    }

    defaultMessage(args: ValidationArguments & { object: ReadLedgerDto }) {
        return `Filters must be in the valid list of filters for type. type: ${args?.object?.type} allowedFilters: ${
            ALLOWED_FILTERS[args?.object?.type]
        } passed in filters ${args?.value}`;
    }
}

export function ValidateFilters(property: string, validationOptions?: ValidationOptions) {
    return function (object: unknown, propertyName: string) {
        registerDecorator({
            name: 'ValidateFiltersRule',
            target: object.constructor,
            propertyName: propertyName,
            constraints: [property],
            options: validationOptions,
            validator: ValidateFiltersRule,
        });
    };
}
