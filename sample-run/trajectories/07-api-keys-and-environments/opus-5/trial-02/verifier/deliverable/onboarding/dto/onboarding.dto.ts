import { ApiHideProperty } from '@nestjs/swagger';
import { Stripe } from 'stripe';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, Length } from 'class-validator';
import { BasicResponseDTO } from '../../basicResponseDTO.js';

export class OnboardingDto {
    /**
     * TThe unique identifier for the SaaS business
     * @example HarperDB
     */
    @ApiHideProperty()
    @IsString()
    @IsOptional()
    public businessID: string;

    /**
     * The subject who sent the request in
     */
    @ApiHideProperty()
    @IsString()
    @IsOptional()
    public sub: string;
}
export class OnboardingResponseDTO extends BasicResponseDTO {
    /**
     * The data associated with the response, will contain relevant stripe information
     */
    @IsOptional()
    @Length(1, 1)
    data?: Array<StripeConnectAccountResponse>;
}

class StripeConnectAccountResponse {
    /**
     * The URL to be directed to in order to complete the strpe onboarding
     * @example https://connect.stripe.com/wowThisIsreallycool
     */
    public url: Stripe.AccountLink['url'];
}

export class DeletedStripeAccountAssociationResponse extends BasicResponseDTO {}
