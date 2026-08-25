import { ValidationArguments, ValidationOptions, registerDecorator } from 'class-validator';
import { paymentChannel } from './create-customer.dto.js';
export function ValidPaymentChannelCustomer(property: string, validationOptions?: ValidationOptions) {
    return function (object: unknown, propertyName: string) {
        registerDecorator({
            name: 'validPaymentChannelCustomer',
            target: object.constructor,
            propertyName: propertyName,
            constraints: [property],
            options: validationOptions,
            validator: {
                async validate(paymentChannelType: any, args: ValidationArguments) {
                    if (paymentChannelType === paymentChannel.Stripe) {
                        try {
                            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                            // @ts-ignore
                            if (args.object.newPaymentChannelOptions?.stripeCustomerId) {
                                return true;
                            } else {
                                return false;
                            }
                        } catch (e) {
                            return false;
                        }
                    } else {
                        return true;
                    }
                },
            },
        });
    };
}
