import {
    ConflictException,
    forwardRef,
    Inject,
    Injectable,
    InternalServerErrorException,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { DeletedStripeAccountAssociationResponse, OnboardingDto, OnboardingResponseDTO } from './dto/onboarding.dto.js';
import { Stripe } from 'stripe';
import { SettingsService } from '../setting/settings.service.js';
import { AccountState } from '../setting/entities/AccountState.js';
import { LocalJWTAuthService } from '../authz/jwt-local.strategy.js';

@Injectable()
export class OnboardingService {
    private static readonly logger = new Logger(OnboardingService.name);
    constructor(
        private settingsService: SettingsService,
        @Inject(forwardRef(() => LocalJWTAuthService)) readonly localJWTAuthService: LocalJWTAuthService,
    ) {}
    async create({ businessID, sub }: OnboardingDto): Promise<OnboardingResponseDTO> {
        const [{ stripeAccountId, accountState }] = await this.settingsService.findAll({ businessID });

        if (stripeAccountId) {
            throw new ConflictException(`Stripe Account already onboarded StripeAccountID: ${stripeAccountId}`);
        } else {
            const stripe = new Stripe(
                accountState === AccountState.production ? process.env.PROD_STRIPE_TOKEN : process.env.STRIPE_TOKEN,
                { apiVersion: '2022-08-01' },
            );
            const { access_token: state } = await this.localJWTAuthService.generateStripeState(sub, businessID);
            const url = await stripe.oauth.authorizeUrl({
                redirect_uri: `${process.env.METERINGCO_URL}/onboarding/stripe/redirect`,
                scope: 'read_write',
                client_id:
                    accountState === AccountState.production
                        ? process.env.STRIPE_PROD_CLIENT_ID
                        : process.env.STRIPE_CLIENT_ID,
                response_type: 'code',
                state,
            });
            try {
            } catch (error) {
                OnboardingService.logger.error(
                    `Failed to link Stripe Account with user StripeAccount: ${stripeAccountId}`,
                    error,
                );
                throw new InternalServerErrorException('Failed to link account to user, try again');
            }
            return {
                message: 'Stripe Account information for onboarding',
                data: [{ url }],
            };
        }
    }

    async redirect({ businessID, authToken }) {
        const [{ accountState }] = await this.settingsService.findAll({ businessID });
        const stripe = new Stripe(
            accountState === AccountState.production ? process.env.PROD_STRIPE_TOKEN : process.env.STRIPE_TOKEN,
            { apiVersion: '2022-08-01' },
        );

        const stripeRes = await stripe.oauth.token({ code: authToken, grant_type: 'authorization_code' });
        const { stripe_user_id } = stripeRes;

        try {
            await this.settingsService.update({ stripeAccountId: stripe_user_id, businessID });
            return { message: 'Successfully linked Stripe Account with user' };
        } catch (error) {
            OnboardingService.logger.error(
                `Failed to link Stripe Account with user StripeAccount: ${stripe_user_id}`,
                error,
            );
            throw new InternalServerErrorException('Failed to link account to user, try again');
        }
    }

    async remove({ businessID }): Promise<DeletedStripeAccountAssociationResponse> {
        const [{ stripeAccountId, accountState }] = await this.settingsService.findAll({ businessID });
        if (stripeAccountId) {
            // const stripe = new Stripe(
            //     accountState === AccountState.production ? process.env.PROD_STRIPE_TOKEN : process.env.STRIPE_TOKEN,
            //     { apiVersion: '2022-08-01' }
            // );
            try {
                // const { id, deleted } = await stripe.accounts.del(stripeAccountId);
                // Create a new entry in the ledger for the user, this time without the stripe account ID
                await this.settingsService.update({ stripeAccountId: null, businessID });
                return { message: 'Sucessfully deleted stripe connect association' };
            } catch (error) {
                OnboardingService.logger.error(`Failed to delete Stripe Account for business: ${businessID}`, error);
                throw new InternalServerErrorException('Failed to Delete Stripe Account for User, try again');
            }
        } else {
            OnboardingService.logger.log('No Stripe account associated with user');
            throw new NotFoundException('No Stripe account associated with user, cannot delete');
        }
    }
}
