import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString, ValidationArguments } from 'class-validator';
import { Environment } from '../../users/dto/Environment.js';

export enum WebhookType {
    INVOICE_CREATED = 'INVOICE_CREATED',
    INVOICE_PAID = 'INVOICE_PAID',
    STRIPE_PAYMENT_FAILED = 'STRIPE_PAYMENT_FAILED',
    CUSTOMER_CREATED = 'CUSTOMER_CREATED',
    CUSTOMER_UPDATED = 'CUSTOMER_UPDATED',
    ENTITLEMENT = 'ENTITLEMENT',
    INVOICE_SENT = 'INVOICE_SENT',
}
export class CreateWebhookDto {
    @IsOptional()
    @ApiHideProperty()
    businessID: string;

    /**
     * The URL MeteringCo will callback to when the webhook type event occurs.
     * <br/><br/>
     * Example: `"https://example.com/webhook"`
     * @example "https://example.com/webhook"
     */
    @ApiProperty()
    @IsString()
    @IsNotEmpty()
    hookUrl: string;

    /**
     * The type of webhook event to listen for. This will determine when the webhook is triggered.
     * <br/><br/>
     * Example: `"INVOICE_CREATED"`
     * @example "INVOICE_CREATED"
     */
    @IsEnum(WebhookType)
    @IsNotEmpty()
    webhookType: WebhookType;

    /**
     * The security key used to authenticate the webhook. This is used to ensure the webhook is coming from MeteringCo. The key will be sent in the `X-MeteringCo-Security` header.
     * <br/><br/>
     * Example: `"1234567890"`
     * @example "1234567890"
     */
    @ApiProperty()
    @IsString()
    @IsOptional()
    securityKey?: string;

    /**
     * The offering the webhook is for. This is used to differentiate between different offerings. Only used for `ENTITLEMENT` webhooks.
     * <br/><br/>
     * Example: `"539b7f74-3832-474e-a955-6d69c5df12d0"`
     * @example "539b7f74-3832-474e-a955-6d69c5df12d0"
     */
    @IsString()
    @IsOptional()
    offeringId?: string;

    /**
     * The environment the webhook is for. This is used to differentiate between sandbox and production. Optional, will default to `production` if not provided.
     * <br/><br/>
     * Example: `"sandbox"`
     * @example "sandbox"
     *
     */
    @ApiProperty()
    @IsEnum(Environment, {
        message: (args: ValidationArguments) => {
            const { value, constraints } = args;
            const correctValues = Object.values(constraints[0]);
            return `environment: The value ${value} is not a valid value for the environment field. The correct values are: ${correctValues}`;
        },
        each: true,
    })
    @IsOptional()
    environment?: string;
}

export class WebhookResponse {
    /**
     * The message returned from the request.
     */
    message: string;
    /**
     * <b> DEPRECATED </b>
     * The unique identifier of the webhook. Kept for backwards compatibility.
     */
    id: string;

    /**
     * The unique identifier of the webhook.
     */
    webhookId: string;
    /**
     * The environment the webhook is for. This is used to differentiate between sandbox and production.
     */
    environment: string;
}
