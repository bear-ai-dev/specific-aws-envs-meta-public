import { ValidatorConstraint } from 'class-validator';
import { default as countryCodes } from '../../setting/countryCode.json';
@ValidatorConstraint({ name: 'countryCode', async: false })
export class CustomCountryCodeValidator {
    validate(countryCode: string) {
        return countryCodes.find(({ alpha2, alpha3 }) => alpha2 === countryCode || alpha3 === countryCode);
    }

    defaultMessage() {
        return 'Invalid Country Code';
    }
}
