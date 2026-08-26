import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { CustomerService } from '../../customer/customer.service';
import { fetch } from 'cross-fetch';
import { OrganizationEntity } from './organization.entity';
import { cache as cacheManager } from '../../cacheStore.js';
import { paymentChannel } from '../../customer/dto/create-customer.dto';
import { AuditService } from '../../audit/audit.service';
import { AuditScope } from '../../audit/entities/audit.interface';
import { serializeError } from 'serialize-error';
import { KeyService, OrganizationService } from '../users.service';

@Injectable()
export class OnboardingEntity {
    private static readonly logger = new Logger(OnboardingEntity.name);
    // Developer One's subject in dogfood
    public static dogfoodUserSubject = 'auth0|64c42221d3e547debaa96f23';
    // Production MeteringCo Dogfood businessID
    public static dogfoodBusinessID = 'meteringco-production';
    // Production MeteringCo Dogfood offeringId
    public static dogfoodMeteringCoOfferingId = '94494cdf-d090-4032-8fc7-1e9b9e7f49cb';
    constructor(
        @Inject(forwardRef(() => CustomerService)) readonly customerService: CustomerService,
        @Inject(forwardRef(() => OrganizationService)) readonly organizationService: OrganizationService,
        @Inject(forwardRef(() => KeyService)) readonly keyService: KeyService,
    ) {}
    async onboardNewUserToDogfood({ businessID, sub }: { businessID: string; sub: string }) {
        try {
            OnboardingEntity.logger.log(`Onboarding new user to dogfood, businessID: ${businessID}, sub: ${sub}`);
            // Get businessName from user metadata in auth0 if it exists. Otherwise use email domain as businessName.
            const { access_token: accessToken } = await OrganizationEntity.getAuth0ManagementToken(cacheManager);
            const res = await fetch(`https://auth.meteringco.example/api/v2/users/${sub}`, {
                method: 'GET',
                headers: {
                    Accept: 'application/json',
                    Authorization: `Bearer ${accessToken}`,
                },
            });
            OnboardingEntity.logger.log(`After fetching user metadata from auth0, status: ${res.status}}`);
            if (!res.ok) {
                OnboardingEntity.logger.error(`Failed to get user metadata from auth0, status: ${res.status}`);
                OnboardingEntity.logger.error(`Failed to fetch user metadata from auth0, body: ${await res.text()}`);
                throw new Error(`Failed to fetch user metadata from auth0, status: ${res.status}`);
            }
            const { user_metadata: userMetadata, email } = await res.json();
            OnboardingEntity.logger.log(`Successfully fetched user metadata from auth0`);
            let customerName;
            if (userMetadata?.businessName) {
                customerName = userMetadata.businessName;
            } else {
                customerName = email.split('@')[1];
            }
            try {
                OnboardingEntity.logger.log(`Creating organization and key permissions for user: ${sub}`);
                await Promise.all([
                    this.organizationService.create({
                        subjects: [sub],
                        businessID,
                        organizationDisplayName: customerName,
                    }),
                    this.keyService.updatePermissions({ subject: sub, businessID, accessToken }),
                ]);
            } catch (e) {
                OnboardingEntity.logger.error(`Failed to create organization for user: ${sub}`);
                OnboardingEntity.logger.error(serializeError(e));
                AuditService.publishEvent({
                    data: [serializeError(e)],
                    message: 'Failed to create organization and key permissions for user',
                    topic: AuditScope.ERROR,
                });
            }
            OnboardingEntity.logger.log(`Customer name: ${customerName}`);
            const customer = await this.customerService.create(
                {
                    businessID: OnboardingEntity.dogfoodBusinessID,
                    customerName,
                    metadata: {
                        businessID,
                    },
                    email,
                    paymentChannel: paymentChannel.Stripe,
                    offeringId: OnboardingEntity.dogfoodMeteringCoOfferingId,
                },
                OnboardingEntity.dogfoodUserSubject,
            );

            OnboardingEntity.logger.log(
                `Successfully onboarded new customer to dogfood, businessID: ${businessID}, sub: ${sub}`,
            );
            return customer;
        } catch (e) {
            OnboardingEntity.logger.error(
                `An error occured while onboarding new customer to dogfood, businessID: ${businessID}, sub: ${sub}`,
            );
            OnboardingEntity.logger.error(serializeError(e));
            AuditService.publishEvent({
                data: [serializeError(e)],
                message: 'Failed to onboard new customer to meteringco dogfood',
                topic: AuditScope.ERROR,
            });
        }
    }
}
