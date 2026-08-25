import {
    Controller,
    Post,
    Delete,
    UseGuards,
    Req,
    ConflictException,
    NotFoundException,
    InternalServerErrorException,
    Get,
    Query,
} from '@nestjs/common';
import { OnboardingService } from './onboarding.service.js';
import {
    ApiConflictResponse,
    ApiInternalServerErrorResponse,
    ApiNotFoundResponse,
    ApiOkResponse,
    ApiTags,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { DeletedStripeAccountAssociationResponse, OnboardingResponseDTO } from './dto/onboarding.dto.js';
import { Request } from 'express';
import { LocalJWTAuthGuard } from '../authz/jwt-local.gaurd.js';
import { AuditService } from '../audit/audit.service.js';
import { AuditScope } from '../audit/entities/audit.interface.js';
import { serializeError } from 'serialize-error';

@Controller('onboarding/stripe')
@ApiTags('Onboarding')
export class OnboardingController {
    constructor(private readonly onboardingService: OnboardingService) {}

    /**
     * Onboard a stripe standard account to be assocaited with your user account
     */
    @ApiOkResponse({
        description: 'Response for creating a stripe account',
        type: OnboardingResponseDTO,
    })
    @ApiConflictResponse({
        description: 'Response for when a new connection is attempted to be established for an existing account',
        type: ConflictException,
    })
    @UseGuards(AuthGuard('jwt'))
    @Post()
    create(@Req() request: Request) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-ignore
        const { businessID, sub } = request.user;
        return this.onboardingService.create({ businessID, sub });
    }

    /**
     * Redirect endpoint for stripe onboarding, follows the second step of the OAuth flow
     * @documentation https://stripe.com/docs/connect/oauth-standard-accounts
     */
    @UseGuards(LocalJWTAuthGuard)
    @Get('redirect')
    async redirect(@Query('code') code, @Req() request: Request) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-ignore
        const { businessID } = request?.user;
        try {
            await this.onboardingService.redirect({ authToken: code, businessID });
        } catch (error) {
            AuditService.publishEvent({
                topic: AuditScope.ERROR,
                message: 'Failed to onboard stripe account',
                data: [serializeError(error)],
            });
            return '<b> Stripe Connect Transaction Cancelled. Please close this Tab and go back to your previous tab.</b>';
        }
        console.log('Logging after redirect');
        return '<b> Sucessfully connected. Please close this Tab and go back to your previous tab. </b>';
    }

    /**
     * Remove stripe connection from account
     */
    @ApiOkResponse({
        description: 'Deleted Account Sucessfully',
        type: DeletedStripeAccountAssociationResponse,
    })
    @ApiNotFoundResponse({ description: 'Unable to find account association', type: NotFoundException })
    @ApiInternalServerErrorResponse({
        description: 'Failed to delete the account association',
        type: InternalServerErrorException,
    })
    @UseGuards(AuthGuard('jwt'))
    @Delete()
    remove(@Req() request: Request) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-ignore
        const { businessID } = request.user;
        return this.onboardingService.remove({ businessID });
    }
}
