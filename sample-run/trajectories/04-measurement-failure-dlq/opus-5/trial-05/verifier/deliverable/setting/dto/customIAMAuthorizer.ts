import { ValidationArguments, ValidationOptions, registerDecorator } from 'class-validator';
import { fromTemporaryCredentials } from '@aws-sdk/credential-providers';
export function ValidIAMRole(property: string, validationOptions?: ValidationOptions) {
    return function (object: unknown, propertyName: string) {
        registerDecorator({
            name: 'validIAMRole',
            target: object.constructor,
            propertyName: propertyName,
            constraints: [property],
            options: validationOptions,
            validator: {
                async validate(iamRoleArn: any, args: ValidationArguments) {
                    try {
                        if (iamRoleArn === '') {
                            return true;
                        }
                        const creds = fromTemporaryCredentials({
                            params: {
                                RoleArn: iamRoleArn,
                                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                                // @ts-ignore
                                ExternalId: args.object?.externalId
                                    ? // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                                      // @ts-ignore
                                      args.object?.externalId
                                    : undefined,
                            },
                            clientConfig: { region: 'us-east-1' },
                        });
                        await creds();
                        return true;
                    } catch (e) {
                        console.log(e);
                        return false;
                    }
                },
            },
        });
    };
}
