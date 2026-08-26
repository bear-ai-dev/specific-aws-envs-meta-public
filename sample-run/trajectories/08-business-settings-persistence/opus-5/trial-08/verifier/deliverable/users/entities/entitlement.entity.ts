import { Inject, Injectable, Logger, NotFoundException, forwardRef } from '@nestjs/common';
import { CustomerReadResponse } from '../../customer/customer.service';
import { CustomerEntity, ReadCustomerResponseData } from '../../customer/entities/customer.entity';
import { InfluxService } from '../../influx/influx.service';
import { OfferingService } from '../../offering/offering.service';
import { AuditService } from '../../audit/audit.service';
import { serializeError } from 'serialize-error';
import { AuditScope } from '../../audit/entities/audit.interface';
import { OrganizationEntity } from './organization.entity';
import { EnvironmentService } from '../users.service';
import { OfferingPackageEntity } from '../../offering/entities/offeringPackage.entity';
import { DimensionEntity } from '../../dimensions/entities/dimensions.entity';
import { CreateDimensionDto } from '../../dimensions/dto/create-dimension.dto.js';

export class EntitlementEntity {
    name: string;
    entitlementLimit: string;
    currentValue?: string;
    entitlementType?: string;
    constructor({
        name,
        entitlementLimit,
        currentValue,
        entitlementType,
    }: {
        name: string;
        entitlementLimit: string;
        currentValue?: string;
        entitlementType?: string;
    }) {
        this.name = name;
        this.entitlementLimit = entitlementLimit;
        this.currentValue = currentValue;
        this.entitlementType = entitlementType;
    }
}

export enum EntitlementTypes {
    OFFERINGS = 'offerings',
    CUSTOMERS = 'customers',
    USERS = 'users',
}

@Injectable()
export class UserEntitlements {
    private static logger = new Logger(UserEntitlements.name);

    constructor(
        @Inject(forwardRef(() => EnvironmentService)) readonly environmentSerivce: EnvironmentService,
        @Inject(forwardRef(() => InfluxService)) readonly influxService: InfluxService,
        @Inject(forwardRef(() => OfferingService)) readonly offeringService: OfferingService,
    ) {}
    async determineIfEntitlementExceeded({
        subject,
        entitlementType,
    }: {
        subject: string;
        entitlementType: EntitlementTypes;
    }): Promise<{ entitlementExceeded: boolean; currentValue: string | null; entitlementValue: string | null }> {
        const allEnvs = await this.environmentSerivce.getEnvironmentsForUser(subject);
        const businessIDs = allEnvs.map((env) => env.businessID);
        const { data: customerData } = await UserEntitlements.queryForMeteringCoCustomer({
            businessIDs,
        });
        if (customerData.length === 0) {
            UserEntitlements.logger.warn(
                `No customer entitlement data found for businessID: ${businessIDs.toString()}`,
            );
            return { entitlementExceeded: false, currentValue: null, entitlementValue: null };
        }
        const entitlements = UserEntitlements.customerToEntitlements({ customer: customerData[0] });
        const entitlement = entitlements.find((entitlement) => entitlement.entitlementType === entitlementType);

        if (entitlement) {
            const queryMap = {
                offerings: this.influxService.getCurrentCountOfOfferings.bind(this.influxService),
                customers: this.influxService.getCurrentCountOfCustomers.bind(this.influxService),
                '/users/organizations': OrganizationEntity.getCountOfOrganizationMembers,
            };
            const res = await queryMap[entitlementType]({ businessIDs });
            UserEntitlements.logger.debug(`Current Count: ${JSON.stringify(res)}`);
            if (res.length > 0 && res[0]?._value) {
                const currentValue = res[0]._value.toString();
                const entitlementValue = entitlement.entitlementLimit;
                const entitlementExceeded = parseInt(currentValue) >= parseInt(entitlementValue);
                return { entitlementExceeded, currentValue, entitlementValue };
            } else {
                return { entitlementExceeded: false, currentValue: null, entitlementValue: null };
            }
        } else {
            return { entitlementExceeded: false, currentValue: null, entitlementValue: null };
        }
    }
    static async queryForMeteringCoCustomer({ businessIDs }: { businessIDs: string[] }): Promise<CustomerReadResponse> {
        UserEntitlements.logger.log(`Getting MeteringCo Customer: ${businessIDs.toString()}`);
        const data = await InfluxService.getMeteringCoCustomers();
        UserEntitlements.logger.debug(`Influx Result Length: ${data?.length}`);
        if (data?.length) {
            const customer = data.find((customer) => {
                if (customer?.metadata) {
                    try {
                        const parsed = JSON.parse(customer.metadata);
                        UserEntitlements.logger.debug(`MeteringCo Customer Metadata: ${JSON.stringify(parsed)}`);
                        if (parsed?.businessID) {
                            UserEntitlements.logger.debug(`MeteringCo Customer BusinessID: ${parsed.businessID}`);
                            return businessIDs.includes(parsed.businessID);
                        } else {
                            return false;
                        }
                    } catch (e) {
                        UserEntitlements.logger.error(`Failed to parse metadata for MeteringCo Customer: ${e.message}`);
                        AuditService.publishEvent({
                            data: [serializeError(e)],
                            message: 'Failed to parse metadata for MeteringCo Customer',
                            topic: AuditScope.ERROR,
                        });
                        return false;
                    }
                } else {
                    return false;
                }
            });
            if (customer) {
                const entity = CustomerEntity.dbModelToEntity(customer);
                let meteringcoCustomerOffering: { offering?: OfferingPackageEntity; dimensions?: DimensionEntity[] } = {};
                try {
                    UserEntitlements.logger.log(`Getting offering for MeteringCo Customer: ${entity.customerId}`);
                    const { offering, dimensions } = await InfluxService.getMeteringCoOffering(entity.offeringId);
                    if (!offering) {
                        throw new NotFoundException(`No offering found for MeteringCo Customer: ${entity.offeringId}`);
                    }
                    meteringcoCustomerOffering = { offering, dimensions };
                } catch (e) {
                    if (e instanceof NotFoundException) {
                        UserEntitlements.logger.warn(`No offering found for MeteringCo Customer: ${e.message}`);
                        return {
                            message: 'Successfully retrieved customer entitlements',
                            data: [
                                {
                                    ...entity,
                                    offering: null,
                                },
                            ],
                        };
                    } else {
                        UserEntitlements.logger.error(`Failed to get offering for MeteringCo Customer: ${e.message}`);
                        AuditService.publishEvent({
                            data: [serializeError(e)],
                            message: 'Failed to get offering for MeteringCo Customer',
                            topic: AuditScope.ERROR,
                        });
                        throw e;
                    }
                }
                UserEntitlements.logger.log(
                    `Successfully retrieved MeteringCo Customer: ${businessIDs.toString()} Offering: ${entity.offeringId}`,
                );
                return {
                    message: 'Successfully retrieved customer entitlements',
                    data: [
                        {
                            ...entity,
                            offering: {
                                ...meteringcoCustomerOffering?.offering,
                                currency: meteringcoCustomerOffering?.offering?.currency as any,
                                dimensions: meteringcoCustomerOffering.dimensions.map((dimensionEntity) => {
                                    const dimensionResponse = new CreateDimensionDto(dimensionEntity);
                                    return {
                                        ...dimensionResponse,
                                        dimensionId: dimensionEntity.dimensionId,
                                    };
                                }),
                            },
                        },
                    ],
                };
            } else {
                UserEntitlements.logger.warn(`No MeteringCo Customer found for BusinessID: ${businessIDs.toString()}`);
                return {
                    message: 'Successfully retrieved customer entitlements',
                    data: [],
                };
            }
        } else {
            return {
                message: 'Successfully retrieved customer entitlements',
                data: [],
            };
        }
    }

    static customerToEntitlements({ customer }: { customer: ReadCustomerResponseData }): EntitlementEntity[] {
        const { offering } = customer;

        if (offering && !Array.isArray(offering)) {
            UserEntitlements.logger.log(
                `Getting entitlements for customer: ${customer.businessID} Offering: ${offering?.offeringId}`,
            );
            const { dimensions } = offering;
            UserEntitlements.logger.debug(`Offering Dimensions Length: ${dimensions?.length}`);
            return dimensions.map(
                (dimension) =>
                    new EntitlementEntity({
                        name: dimension.dimensionName,
                        entitlementLimit: dimension.usageEntitlement ? dimension.usageEntitlement.toString() : '0',
                        entitlementType: dimension?.metadata?.entitlementType.toString(),
                    }),
            );
        } else {
            UserEntitlements.logger.warn(`No offering found for customer: ${customer.businessID}`);
            return [];
        }
    }
}
