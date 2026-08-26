import { ValidatorConstraint } from 'class-validator';

@ValidatorConstraint({ name: 'value', async: false })
export class IsNumericStringGreaterThanOrEqualToZeroValidator {
    validate(value: string) {
        return !isNaN(Number(value)) && Number(value) >= 0;
    }

    defaultMessage() {
        return 'Invalid value: must be a number greater than or equal to zero in string format';
    }
}

@ValidatorConstraint({ name: 'value', async: false })
export class IsNumericStringGreaterToZeroValidator {
    validate(value: string) {
        return !isNaN(Number(value)) && Number(value) > 0;
    }

    defaultMessage() {
        return 'Invalid value: must be a number greater than zero in string format';
    }
}

// Validate numerical string less than or equal to 100
@ValidatorConstraint({ name: 'value', async: false })
export class IsNumericStringLessThanOrEqualToHundredValidator {
    validate(value: string) {
        return !isNaN(Number(value)) && Number(value) <= 100;
    }

    defaultMessage() {
        return 'Invalid value: must be a number less than or equal to 100 in string format';
    }
}
