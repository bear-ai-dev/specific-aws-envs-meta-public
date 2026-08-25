import { ValidationArguments, ValidationOptions, registerDecorator } from 'class-validator';
export function ValidServiceApplicationID(property: string, validationOptions?: ValidationOptions) {
    return function (object: unknown, propertyName: string) {
        registerDecorator({
            name: 'validServiceApplicationID',
            target: object.constructor,
            propertyName: propertyName,
            constraints: [property],
            options: validationOptions,
            validator: {
                async validate(idValue: any, args: ValidationArguments) {
                    try {
                        if (idValue) {
                            return true;
                            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                            // @ts-ignore
                        } else if (args.object?.applicationId) {
                            return true;
                        } else {
                            return false;
                        }
                    } catch (e) {
                        return false;
                    }
                },
            },
        });
    };
}
