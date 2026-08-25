import { forwardRef, Inject, Injectable } from '@nestjs/common';
import {
    ValidationOptions,
    registerDecorator,
    ValidationArguments,
    ValidatorConstraintInterface,
    ValidatorConstraint,
} from 'class-validator';
import Taxjar from 'taxjar';
import { AccountState } from '../entities/AccountState.js';
import { SettingsService } from '../settings.service.js';
import { TaxCalculationType } from './TaxCalculationType.js';
import { UpdateSettingsDto } from './update-settings.dto.js';

@ValidatorConstraint({ name: 'TaxJarApiKeySetRule', async: true })
@Injectable()
export class TaxJarApiKeySetRule implements ValidatorConstraintInterface {
    constructor(@Inject(forwardRef(() => SettingsService)) readonly settingsService: SettingsService) {}

    async validate(taxType: string, args: ValidationArguments) {
        try {
            if (taxType === TaxCalculationType.meteringcoCalculated) {
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                const [settings] = await this.settingsService.findAll({ businessID: args?.object?.businessID });
                if (settings?.taxJarApiKey) {
                    return true;
                }
                const inputForSettings = args.object as UpdateSettingsDto;

                if (inputForSettings?.taxJarApiKey) {
                    return true;
                }
            } else {
                return true;
            }
        } catch (e) {
            console.error(e, 'error');
            return false;
        }
    }

    defaultMessage(args: ValidationArguments) {
        return `TaxJar API Key must be set for MeteringCo to calculate taxes`;
    }
}

export function TaxJarApiKeySet(property: string, validationOptions?: ValidationOptions) {
    return function (object: unknown, propertyName: string) {
        registerDecorator({
            name: 'TaxJarApiKeySet',
            target: object.constructor,
            propertyName: propertyName,
            constraints: [property],
            options: validationOptions,
            validator: TaxJarApiKeySetRule,
        });
    };
}

@ValidatorConstraint({ name: 'TaxJarApiKeySetRule', async: true })
@Injectable()
export class ValidTaxJarApiKeyRule implements ValidatorConstraintInterface {
    constructor(@Inject(forwardRef(() => SettingsService)) readonly settingsService: SettingsService) {}

    async validate(validTaxJarApiKey: string, args: ValidationArguments) {
        try {
            const passedInObj = args.object as UpdateSettingsDto;
            if (validTaxJarApiKey === '') {
                return true;
            }
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            const [settings] = await this.settingsService.findAll({ businessID: args?.object?.businessID });
            let accountState;
            if (settings?.accountState) {
                accountState = settings?.accountState;
            }
            if (passedInObj?.accountState) {
                accountState = passedInObj?.accountState;
            }
            const client = new Taxjar({
                apiKey: validTaxJarApiKey,
                apiUrl:
                    accountState === AccountState.production ? process.env.PROD_TAX_JAR_URL : process.env.TAX_JAR_URL,
            });
            // Fake order, from api reference.
            await client.taxForOrder({
                from_country: 'US',
                from_zip: '07001',
                from_state: 'NJ',
                from_city: 'Avenel',
                from_street: '305 W Village Dr',
                to_country: 'US',
                to_zip: '07446',
                to_state: 'NJ',
                to_city: 'Ramsey',
                to_street: '63 W Main St',
                amount: 16.5,
                shipping: 1.5,
                line_items: [
                    {
                        id: '1',
                        quantity: 1,
                        product_tax_code: '31000',
                        unit_price: 15.0,
                        discount: 0,
                    },
                ],
            });
            return true;
        } catch (e) {
            console.error(e, 'error');
            return false;
        }
    }

    defaultMessage(args: ValidationArguments) {
        return `TaxJar API Key must be set for MeteringCo to calculate taxes`;
    }
}

export function ValidTaxJarApiKey(property: string, validationOptions?: ValidationOptions) {
    return function (object: unknown, propertyName: string) {
        registerDecorator({
            name: 'ValidTaxJarApiKey',
            target: object.constructor,
            propertyName: propertyName,
            constraints: [property],
            options: validationOptions,
            validator: ValidTaxJarApiKeyRule,
        });
    };
}
