import {
    BadRequestException,
    ConflictException,
    forwardRef,
    Inject,
    Injectable,
    InternalServerErrorException,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import {
    CreateCustomerDto,
    CreateCustomerResponseDto,
    paymentChannel as PaymentChannel,
    StripePaymentChannelOptions,
} from './dto/create-customer.dto.js';
import { InfluxService } from '../influx/influx.service.js';
import {
    CustomerEntity,
    CustomerInvoiceMetadata,
    ReadAllCustomersResponseData,
    ReadCustomerResponseData,
} from './entities/customer.entity.js';
import { v4 } from 'uuid';
import { UpdateCustomerDto, UpdateCustomerResponseDto } from './dto/update-customer.dto.js';
import { Invoice, PresignedURLType } from '../invoice/entities/invoice.entity.js';
import { SchedulerService } from '../scheduler/scheduler.service.js';
import { OfferingService } from '../offering/offering.service.js';
import { ReadUsageForCustomerDto } from '../usage/dto/read-usage.dto.js';
import {
    AggregatedUsageResponse,
    BasicUsageDocument,
    GetCustomerStripePortalResponse,
    QueryParamUsageDto,
    ReadCustomerUsageData,
    UnAggregatedUsageResponse,
    UsageResponseDocument,
} from './dto/read-customer.dto.js';
import { AggregationPurpose } from './dto/AggregationPurpose.js';
import { UsageService } from '../usage/usage.service.js';

import { Offering } from '../offering/entities/offeringPackage.entity.js';
import { InvoicesService } from '../invoice/invoices.service.js';
import { LocalJWTAuthService } from '../authz/jwt-local.strategy.js';
import { CustomerAuthenticationTokenResponse } from './dto/get-customer-auth.dto.js';
import { CustomerCommunicationEntity } from './entities/customerCommunication.entity.js';
import { CustomerCommunicationChannel } from './entities/customerCommunication.interface.js';
import { SettingsService } from '../setting/settings.service.js';
import { CreditService } from '../credit/credit.service.js';
import { StripePaymentProcessor } from '../payment/entities/payment.entity.js';
import { StripeRefundChannelOptions } from './dto/create-customer-refund.dto.js';
import { UpdateFreeTrialResponseDto } from './dto/updateFreeTrial.dto.js';
import { AuditService } from '../audit/audit.service.js';
import { AuditScope } from '../audit/entities/audit.interface.js';
import { serializeError } from 'serialize-error';
import { WebhookProcessorEventType, WebhookPublishingService } from '../webhook/webhook.service.js';
import { WebhookType } from '../webhook/dto/create-webhook.dto.js';
import { PaymentService } from '../payment/payment.service.js';
import { StripeRefundResponseDto } from '../payment/dto/stripeRefundResponse.dto.js';
import { StripePaymentResponseDto } from '../payment/dto/stripePaymentResponse.dto.js';
import { ReadPaymentDto } from '../payment/dto/readPayment.dto.js';
import { ReadSettingsResponseData } from '../setting/dto/read-setting.dto.js';
import { AccountState } from '../setting/entities/AccountState.js';
import { Billing } from '../billing/entities/billing.entity.js';
import { joinMetadataObjectsAndRemoveNulls } from '../utils/shared/utils.js';
import { EntitlementTypes, UserEntitlements } from '../users/entities/entitlement.entity.js';
import { ContractService } from '../contract/contract.service.js';
import { CreateContractResponseDto } from '../contract/dto/createContractResponse.dto.js';
import { CustomOverrides } from '../contract/dto/prepareContractResponse.dto.js';
import { ReadContractResponseDto } from '../contract/dto/readContract.dto.js';
import { DeleteCustomerResponseDto } from './dto/deleteCustomerResponse.dto.js';
import { UsageForCustomerEnrollment } from '../usage/dto/create-usage.dto.js';
import { TokenConsumerService } from '../token-consumer/token-consumer.service.js';
import { TokenType } from '../token-consumer/dto/TokenType.js';
import { CustomerInfluxRow } from '../influx/entities/customerInfluxRow.js';
import { CustomerGroupService } from '../customergroup/customergroup.service.js';
import { ReadChildRowResponseData } from '../customergroup/dto/ReadChildRowResponseData.js';

export type CustomerReadResponse = { data: ReadCustomerResponseData[]; message: string };
export type ReadAllCustomerResponse = { data: ReadAllCustomersResponseData[]; message: string };

@Injectable()
export class CustomerService {
    public static customerCommunicationSystem = new CustomerCommunicationEntity();
    private static readonly logger = new Logger(CustomerService.name);

    /**
     * Wires the mail channel of the customer communication bus up to the mail provider. Subscribing is
     * idempotent, so calling it more than once never puts a communication on the wire twice.
     */
    public subscribeForCustomerCommunicationEvents() {
        CustomerService.customerCommunicationSystem.subscribe(
            CustomerCommunicationChannel.EMAIL,
            CustomerCommunicationEntity.emailProcessor,
        );
    }

    constructor(
        @Inject(forwardRef(() => InfluxService)) readonly InfluxService: InfluxService,
        @Inject(forwardRef(() => SchedulerService)) readonly schedulerService: SchedulerService,
        @Inject(forwardRef(() => OfferingService)) readonly offeringService: OfferingService,
        @Inject(forwardRef(() => UsageService)) readonly usageService: UsageService,
        @Inject(forwardRef(() => InvoicesService)) readonly invoicesService: InvoicesService,
        @Inject(forwardRef(() => LocalJWTAuthService)) readonly localJWTAuthService: LocalJWTAuthService,
        @Inject(forwardRef(() => SettingsService)) readonly settingsService: SettingsService,
        @Inject(forwardRef(() => CreditService)) readonly creditService: CreditService,
        @Inject(forwardRef(() => PaymentService)) readonly paymentService: PaymentService,
        @Inject(forwardRef(() => UserEntitlements)) readonly userEntitlements: UserEntitlements,
        @Inject(forwardRef(() => ContractService)) readonly contractService: ContractService,
        @Inject(forwardRef(() => TokenConsumerService)) readonly tokenConsumerService: TokenConsumerService,
        @Inject(forwardRef(() => CustomerGroupService)) readonly customerGroupService: CustomerGroupService,
    ) {}

    async create(
        createCustomerDto: CreateCustomerDto,
        subject: string,
        overridesForCustomer?: CustomOverrides,
    ): Promise<CreateCustomerResponseDto> {
        CustomerService.logger.log('Customer DTO', createCustomerDto);
        const res = await this.userEntitlements.determineIfEntitlementExceeded({
            subject,
            entitlementType: EntitlementTypes.CUSTOMERS,
        });
        if (res?.entitlementExceeded) {
            throw new ConflictException(
                `Failed to create customer. Customer entitlement limit of ${res?.entitlementValue} has been reached.`,
            );
        }
        let customerId;
        if (createCustomerDto?.customerId) {
            const customerConfig = await this.InfluxService.getLatestCustomer({
                businessID: createCustomerDto?.businessID,
                customerId: createCustomerDto?.customerId,
            });
            if (customerConfig?.length) {
                throw new BadRequestException(
                    `Failed to create customer. customerId: ${createCustomerDto.customerId} already exists.`,
                );
            }
            customerId = createCustomerDto.customerId;
        } else {
            customerId = v4();
        }

        const { loadPoints } = this.InfluxService;
        const { businessID, offeringId, paymentChannel } = createCustomerDto;
        const stripeCustomerId = createCustomerDto.paymentChannelOptions?.stripeCustomerId;
        const [settingsEntity] = await this.settingsService.findAll({ businessID });
        const { accountState, stripeAccountId: businessStripeAccount } = settingsEntity;
        if (
            paymentChannel === PaymentChannel.Stripe &&
            (!stripeCustomerId || stripeCustomerId === '') &&
            (!businessStripeAccount || businessStripeAccount === '')
        ) {
            throw new BadRequestException(
                `Failed to create customer. Must enable Stripe Connect in order to automatically add customer to Stripe.`,
            );
        }

        let contract: CreateContractResponseDto;
        if (offeringId) {
            contract = await this.contractService.create({
                customerId,
                offeringId,
                businessID,
                readSettingsResponseData: settingsEntity,
                usageOverrides: createCustomerDto?.usage,
                ...overridesForCustomer,
            });
        }
        let updatedStripeCustomerId: string;
        let portalUrl: string;
        const shouldCreateStripeCustomer = CustomerEntity.shouldCreateStripeCustomer({
            newCustomerPaymentChannel: createCustomerDto?.paymentChannel,
            newPaymentChannelOptions: createCustomerDto?.paymentChannelOptions,
        });
        if (shouldCreateStripeCustomer) {
            const results = await CustomerEntity.createStripeCustomer({
                customerName: createCustomerDto?.customerName,
                email: createCustomerDto?.email,
                businessStripeAccount,
                accountState,
            });
            updatedStripeCustomerId = results.stripeCustomerId;
            portalUrl = results.portalUrl;
        }
        const customerEntity = new CustomerEntity({
            ...createCustomerDto,
            freeTrialEndDate: contract?.overridesForOffering?.freeTrialEndDate,
            freeTrialStartDate: contract?.overridesForOffering?.freeTrialEndDate ? new Date().toISOString() : undefined,
            customerId,
            paymentChannelOptions: shouldCreateStripeCustomer
                ? { stripeCustomerId: updatedStripeCustomerId }
                : createCustomerDto?.paymentChannelOptions,
            creditBalance: contract?.prepaidCredit,
            offeringEnrollmentDate: contract?.offeringEnrollmentDate,
        });
        const points = CustomerEntity.transformer(customerEntity, this.InfluxService);
        await loadPoints(`${process.env.STAGE}-config`, process.env.INFLUX_ORG, points);

        if (contract) {
            await this.contractService.enrollCustomerInContract(
                contract,
                subject,
                new ReadCustomerResponseData(customerEntity, [], contract),
            );
        }
        try {
            await this.tokenConsumerService.create({
                subject,
                businessID,
                tokenAmount: '1',
                metadata: {
                    tokenType: TokenType.customer,
                },
            });
        } catch (e) {
            CustomerService.logger.error('Failed to meter token for customer', serializeError(e));
            AuditService.publishEvent({
                topic: AuditScope.ERROR,
                message: 'Failed to meter token for customer',
                data: [{ customerId, businessID, error: serializeError(e) }],
            });
        }
        WebhookPublishingService.publishEvent({
            topic: WebhookProcessorEventType.Standard,
            type: WebhookType.CUSTOMER_CREATED,
            data: [
                new ReadCustomerResponseData(
                    {
                        ...customerEntity,
                        freeTrialEndDate: (contract as ReadContractResponseDto)?.overridesForOffering?.freeTrialEndDate,
                        creditBalance: contract?.prepaidCredit,
                    },
                    [],
                    contract,
                ),
            ],
            businessID,
        });
        return {
            message: 'New customer added',
            customerId: customerEntity.customerId,
            portalUrl,
        };
    }

    private async findInvoicesByCustomer({
        businessID,
        customerId,
        paymentChannel,
        paymentChannelOptions,
        settingsResponseData,
        getPaymentInfo = true,
        generateInvoicePaymentLink = false,
    }: {
        businessID: string;
        customerId: string;
        paymentChannel?: PaymentChannel;
        paymentChannelOptions?: StripePaymentChannelOptions;
        settingsResponseData?: ReadSettingsResponseData;
        getPaymentInfo: boolean;
        generateInvoicePaymentLink?: boolean;
    }) {
        CustomerService.logger.log(`Finding invoices for customer ${customerId} of business ${businessID}`);
        const invoiceDbModels = await this.InfluxService.getInvoicesForCustomer({ businessID, customerId });
        if (invoiceDbModels.length > 0) {
            const amountPaidForInvoices = await this.paymentService.getAmountPaidForCustomerInvoices({
                customerId,
                businessID,
            });
            let refundMap = {};
            let paymentMap = {};
            let mixedPaymentMap = {};
            if (getPaymentInfo) {
                const { data: refundsForCustomer } = await this.findRefunds({
                    businessID,
                    customerId,
                    paymentChannel,
                    paymentChannelOptions,
                    accountState: settingsResponseData?.accountState,
                    stripeAccountId: settingsResponseData?.stripeAccountId,
                });
                refundMap = refundsForCustomer.reduce((acc, refund) => {
                    if (refund?.metadata?.invoiceId) {
                        if (!acc[refund.metadata?.invoiceId]) {
                            acc[refund.metadata?.invoiceId] = [];
                        }
                        acc[refund.metadata?.invoiceId].push(refund);
                    }
                    return acc;
                }, {});

                const { data: paymentsForCustomer } = await this.findPayments({
                    businessID,
                    customerId,
                    paymentChannel,
                    paymentChannelOptions,
                    accountState: settingsResponseData?.accountState,
                    stripeAccountId: settingsResponseData?.stripeAccountId,
                });
                paymentMap = paymentsForCustomer.reduce((acc, payment) => {
                    if (payment?.metadata?.invoiceId) {
                        if (!acc[payment.metadata?.invoiceId]) {
                            acc[payment.metadata?.invoiceId] = [];
                        }
                        acc[payment.metadata?.invoiceId].push(new ReadPaymentDto(payment));
                    }
                    return acc;
                }, {});

                const { data } = await this.creditService.getCreditLedger({ businessID, customerId });
                mixedPaymentMap = data.reduce((acc, credit) => {
                    if (credit?.metadata?.invoiceId) {
                        if (!acc[credit.metadata?.invoiceId]) {
                            acc[credit.metadata?.invoiceId] = [];
                        }
                        acc[credit.metadata?.invoiceId].push(new ReadPaymentDto(credit));
                    }
                    return acc;
                }, paymentMap);
            }
            const responseData = await Promise.all(
                invoiceDbModels.map(async (dbModel) => {
                    const entity = Invoice.fromDBModel(dbModel);
                    if (generateInvoicePaymentLink) {
                        entity.paymentLink = await entity.generatePresignedUrl(
                            PresignedURLType.Payment,
                            this.localJWTAuthService,
                        );
                    }
                    const result = new CustomerInvoiceMetadata(entity);

                    result.amountPaid = amountPaidForInvoices[result.invoiceId] || 0;
                    if (getPaymentInfo) {
                        result.payments = mixedPaymentMap[result.invoiceId] || [];
                        result.payments = result.payments.sort(
                            (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
                        );
                        result.refunds = refundMap[result.invoiceId] || [];
                    }
                    return result;
                }),
            );

            return { data: responseData, message: 'Found invoices for customer' };
        } else {
            return { data: [], message: 'No invoices found for customer' };
        }
    }

    async findAll({ businessID }): Promise<ReadAllCustomerResponse> {
        CustomerService.logger.log(`Finding customers for ${businessID}`);
        const [customerDBModels, settingsArr] = await Promise.all([
            this.InfluxService.getLatestCustomers({ businessID }),
            this.settingsService.findAll({ businessID }),
        ]);
        const entities = customerDBModels.map((dbModel) => CustomerEntity.dbModelToEntity(dbModel));
        const [settingsEntity] = settingsArr;
        const [readContractResponses, balances, customerIdInvoiceMap, children] = await Promise.all([
            this.contractService.findAll({
                businessID,
                customers: entities.filter((e) => e.offeringId),
            }),
            this.creditService.findAllCreditBalances({
                businessID,
                customerIds: entities.map((e) => e.customerId),
            }),
            this.invoicesService.findAllInvoicesForBusiness(businessID),
            this.customerGroupService.findAllChildRows({ businessID }),
        ]);

        const customerIdMap = readContractResponses.reduce(
            (acc, curr) => {
                acc[`${curr.customerId}${curr.offeringId}`] = curr;
                return acc;
            },
            {} as { [key: string]: ReadContractResponseDto },
        );
        let parentMap = {};
        let childrenMap = {};
        if (children?.data && children?.data.length > 0) {
            parentMap = children?.data.reduce((acc, child) => {
                if (!acc[child.parentId]) {
                    acc[child.parentId] = [];
                }
                acc[child.parentId].push(child);
                return acc;
            }, {});
            childrenMap = children?.data.reduce((acc, child) => {
                acc[child.childId] = child;
                return acc;
            }, {});
        }
        const customerWalletBalances = balances.reduce(
            (acc, item) => {
                acc[item?.customerId] = item?.balance;
                return acc;
            },
            {} as { [key: string]: string },
        );

        if (customerDBModels.length > 0) {
            const response = await Promise.all(
                entities.map(async ({ customerId, ...rest }) => {
                    const invoiceEntities = customerIdInvoiceMap[customerId];
                    const children = parentMap[customerId];
                    const parent = childrenMap[customerId];
                    const invoices =
                        invoiceEntities?.length > 0
                            ? invoiceEntities.map((invoice) => new CustomerInvoiceMetadata(invoice))
                            : [];
                    let contract: ReadContractResponseDto[];
                    if (rest?.offeringIds) {
                        const ids = rest?.offeringIds;
                        contract = ids.map((offeringId) => {
                            const result = customerIdMap[`${customerId}${offeringId}`];
                            if (!result) {
                                console.log(`Failed to find result`, result, customerId, offeringId, customerIdMap);
                                return result;
                            } else {
                                return result;
                            }
                        });
                    }

                    const res = await this.buildReadCustomerResponse({
                        customerConfig: [{ customerId, ...rest }],
                        customerId,
                        businessID,
                        getStripeInfo: false,
                        settingsEntity,
                        invoices,
                        contract,
                        balance: customerWalletBalances[customerId],
                        children,
                        parent,
                    });
                    return res?.data?.[0];
                }),
            );
            CustomerService.logger.debug(`Found ${response.length} customers for ${businessID}`);
            return {
                data: response,
                message: 'Found Customers',
            };
        } else {
            return { data: [], message: 'No Customers Found' };
        }
    }

    async findOne({
        customerId,
        businessID,
        getPaymentInfo = true,
    }: {
        customerId: string;
        businessID: string;
        getPaymentInfo?: boolean;
    }): Promise<CustomerReadResponse> {
        CustomerService.logger.log(`Finding saasClientID: ${customerId} for ${businessID}`);
        const customerConfig = await this.InfluxService.getLatestCustomer({ businessID, customerId });
        const [settingsEntity] = await this.settingsService.findAll({ businessID });
        if (customerConfig?.length > 0) {
            const entity = CustomerEntity.dbModelToEntity(customerConfig[0]);
            const { data: invoices } = await this.findInvoicesByCustomer({
                customerId,
                businessID,
                paymentChannel: entity?.paymentChannel,
                paymentChannelOptions: entity?.paymentChannelOptions,
                settingsResponseData: settingsEntity,
                getPaymentInfo,
                generateInvoicePaymentLink: true,
            });
            let contract: ReadContractResponseDto | ReadContractResponseDto[];
            if (entity?.offeringIds && entity?.offeringIds?.length > 0) {
                if (entity?.offeringIds?.length === 1) {
                    const contractRes = await this.contractService.findOne({
                        businessID,
                        offeringId: entity?.offeringId,
                        customerId,
                        offeringEnrollmentDate: entity?.offeringEnrollmentDate,
                        freeTrialEndDate: entity?.freeTrialEndDate,
                    });
                    contract = contractRes;
                } else {
                    const readContractDtos = entity?.offeringIds.map((offeringId) => ({
                        offeringId,
                        customerId,
                        businessID,
                    }));
                    contract = await this.contractService.findAllContractsForCustomer(readContractDtos);
                }
            }
            const children = await this.customerGroupService.findAllChildRowsForParent({
                parentId: customerId,
                businessID,
            });
            const res = await this.customerGroupService.findOneChildRow({ childId: customerId, businessID });
            let parent = {};
            if (res?.data && res?.data.length > 0) {
                if (res?.data[0]?.parentId) {
                    parent = res?.data[0];
                }
            }
            return this.buildReadCustomerResponse({
                customerConfig,
                customerId,
                businessID,
                getStripeInfo: true,
                settingsEntity,
                invoices,
                contract,
                children: children && children?.data && children?.data.length > 0 ? children?.data : undefined,
                parent,
            });
        } else {
            throw new NotFoundException(`Customer with ID: ${customerId} not found`);
        }
    }
    async findAllCustomersWithOfferingId({ businessID, offeringId }): Promise<CustomerReadResponse> {
        const customerDBModels = await this.InfluxService.getLatestCustomers({ businessID });
        const entities = customerDBModels
            .map((dbModel) => CustomerEntity.dbModelToEntity(dbModel))
            .filter((e) => e?.offeringIds && e?.offeringIds?.includes(offeringId));
        const readContractResponses = await this.contractService.findAll({ businessID, customers: entities });
        const customerIdMap = readContractResponses.reduce(
            (acc, curr) => {
                acc[curr.customerId] = curr;
                return acc;
            },
            {} as { [key: string]: ReadContractResponseDto },
        );
        const [settingsEntity] = await this.settingsService.findAll({ businessID });
        const customerIdInvoiceMap = await this.invoicesService.findAllInvoicesForBusiness(businessID);
        if (entities.length > 0) {
            const response = await Promise.all(
                entities.map(async ({ customerId, ...rest }) => {
                    const invoiceEntities = customerIdInvoiceMap[customerId];
                    const invoices =
                        invoiceEntities?.length > 0
                            ? invoiceEntities.map((invoice) => new CustomerInvoiceMetadata(invoice))
                            : [];
                    const contract = customerIdMap[customerId];
                    const res = await this.buildReadCustomerResponse({
                        customerConfig: [{ customerId, ...rest }],
                        customerId,
                        businessID,
                        getStripeInfo: false,
                        settingsEntity,
                        invoices,
                        contract,
                    });
                    return res?.data?.[0];
                }),
            );
            CustomerService.logger.debug(`Found ${response.length} customers for ${businessID}`);
            return {
                data: response,
                message: 'Found Customers',
            };
        } else {
            return { data: [], message: 'No Customers Found' };
        }
    }

    private async buildReadCustomerResponse({
        customerConfig,
        customerId,
        businessID,
        getStripeInfo = true,
        settingsEntity,
        invoices,
        contract,
        balance,
        children,
        parent,
    }: {
        customerConfig: CustomerInfluxRow[] | CustomerEntity[];
        customerId: string;
        businessID: string;
        getStripeInfo?: boolean;
        settingsEntity: ReadSettingsResponseData;
        invoices: CustomerInvoiceMetadata[];
        contract?: ReadContractResponseDto | ReadContractResponseDto[];
        balance?: string;
        children?: ReadChildRowResponseData[];
        parent?: ReadChildRowResponseData;
    }): Promise<CustomerReadResponse> {
        if (customerConfig.length > 0) {
            let entity: CustomerEntity;
            //eslint-disable-next-line
            // @ts-ignore
            if (customerConfig[0]?._measurement === undefined) {
                entity = customerConfig[0] as CustomerEntity;
            } else {
                entity = CustomerEntity.dbModelToEntity(customerConfig[0] as CustomerInfluxRow);
            }

            // enrich with customer wallet
            let customerWalletBalance = balance;
            if (!customerWalletBalance) {
                const { balance: foundBalance } = await this.creditService.findCreditBalance({
                    businessID,
                    customerId,
                });
                customerWalletBalance = foundBalance;
            }
            // enrich with payment information
            const paymentChannel = entity?.paymentChannel;
            const stripeCustomerId = entity?.paymentChannelOptions?.stripeCustomerId;
            let stripeAccountReady = undefined;
            if (paymentChannel === PaymentChannel.Stripe && stripeCustomerId && getStripeInfo) {
                const { stripeAccountId: businessStripeAccount, accountState } = settingsEntity;
                if (businessStripeAccount) {
                    try {
                        const customerObj = await CustomerEntity.getStripeCustomer(
                            stripeCustomerId,
                            businessStripeAccount,
                            accountState,
                        );
                        if (customerObj) {
                            stripeAccountReady = await CustomerEntity.stripeCustomerPaymentInfoComplete(customerObj);
                        } else {
                            stripeAccountReady = false;
                        }
                    } catch (e) {
                        CustomerService.logger.warn(e.statusCode === 404 ? 'Stripe customer not found' : e.message);
                        stripeAccountReady = false;
                    }
                }
            }
            let responseData: ReadCustomerResponseData[];
            if (contract && Array.isArray(contract)) {
                responseData = [
                    new ReadCustomerResponseData(
                        {
                            ...entity,
                            creditBalance: customerWalletBalance,
                            freeTrialEndDate: contract[0]?.overridesForOffering?.freeTrialEndDate,
                        },
                        invoices,
                        contract,
                        stripeAccountReady,
                        children,
                        parent,
                    ),
                ];
            } else {
                responseData = [
                    new ReadCustomerResponseData(
                        {
                            ...entity,
                            freeTrialEndDate: (contract as ReadContractResponseDto)?.overridesForOffering
                                ?.freeTrialEndDate,
                            creditBalance: customerWalletBalance,
                        },
                        invoices,
                        contract,
                        stripeAccountReady,
                        children,
                        parent,
                    ),
                ];
            }
            return {
                data: responseData,
                message: 'Found Customer',
            };
        } else {
            throw new NotFoundException(`Customer with ID: ${customerId} not found`);
        }
    }

    async remove({ customerId, businessID }): Promise<DeleteCustomerResponseDto> {
        CustomerService.logger.log(`Attempting to delete customerId: ${customerId} for ${businessID}`);
        const customerConfig = await this.InfluxService.getLatestCustomer({ businessID, customerId });
        if (customerConfig.length === 0) {
            throw new NotFoundException(`Customer with ID: ${customerId} not found`);
        } else {
            const children = await this.customerGroupService.findAllChildRowsForParent({
                parentId: customerId,
                businessID,
            });
            if (children?.data?.length > 0) {
                throw new BadRequestException(
                    `Failed to delete customer. Customer has children. Remove children before deleting customer.`,
                );
            }
            const { loadPoints } = this.InfluxService;
            const entity = CustomerEntity.dbModelToEntity(customerConfig[0]);
            const { offeringId } = entity;
            entity.softDelete = true;
            entity.businessID = businessID;
            const points = CustomerEntity.transformer(entity, this.InfluxService);
            CustomerService.logger.log('Points to delete', points);
            if (offeringId) {
                try {
                    const {
                        data: [oldOfferingConfig],
                    } = await this.offeringService.findOne({ businessID, offeringId });
                    const [settingsEntity] = await this.settingsService.findAll({ businessID });
                    const oldOffering = Offering.getInstance(
                        oldOfferingConfig,
                        customerId,
                        businessID,
                        this.invoicesService,
                        settingsEntity,
                        this.schedulerService,
                        this,
                        entity?.freeTrialEndDate,
                    );
                    await oldOffering.unenroll({
                        customer: { ...entity, offering: oldOfferingConfig, children: [] },
                    });
                } catch (e) {
                    if (e instanceof NotFoundException) {
                        CustomerService.logger.warn(
                            `Failed to unenroll customer ${customerId} from offering ${offeringId}`,
                        );
                    } else {
                        throw e;
                    }
                }
            }
            await loadPoints(`${process.env.STAGE}-config`, process.env.INFLUX_ORG, points);
        }
        return { message: 'Deleted Customer', customerId };
    }

    async update(
        { businessID, removePriorOffering = true, ...updatedFields }: UpdateCustomerDto,
        sub: string,
        customerId: string,
        overridesForCustomer?: CustomOverrides,
        usage?: UsageForCustomerEnrollment[],
    ): Promise<UpdateCustomerResponseDto> {
        CustomerService.logger.log(`Attempting to update saasClientID: ${customerId} for ${businessID}`);
        const {
            data: [{ ...rest }],
        } = await this.findOne({ customerId, businessID });
        const { loadPoints } = this.InfluxService;
        let freeTrialEndDate;
        let freeTrialStartDate;

        const { balance } = await this.creditService.findCreditBalance({ businessID, customerId });
        if (updatedFields?.currency && updatedFields?.currency !== rest?.currency) {
            if (parseFloat(balance) !== 0) {
                throw new BadRequestException(
                    `Customer must not have a balance in order to change currency. Update the balance from: ${balance}`,
                );
            }
        }
        let creditAmount = balance;

        const oldCustomerPaymentChannel = rest?.paymentChannel;
        const newCustomerPaymentChannel = updatedFields?.paymentChannel
            ? updatedFields?.paymentChannel
            : oldCustomerPaymentChannel;
        const shouldCreateStripeCustomer = CustomerEntity.shouldCreateStripeCustomer({
            oldCustomerPaymentChannel,
            newCustomerPaymentChannel,
            newPaymentChannelOptions: updatedFields?.paymentChannelOptions,
        });
        let settingsEntity;
        let businessStripeAccount;

        if (shouldCreateStripeCustomer) {
            [settingsEntity] = await this.settingsService.findAll({ businessID });
            ({ stripeAccountId: businessStripeAccount } = settingsEntity);
            if (!businessStripeAccount || businessStripeAccount === '') {
                throw new BadRequestException(
                    `Failed to update customer. Must enable Stripe Connect in order to automatically add customer to Stripe.`,
                );
            }
        }
        let newOfferingEnrollmentDate;

        CustomerService.logger.log('Updated fields', updatedFields);
        CustomerService.logger.log(
            `Comparision Check: ${
                (updatedFields?.offeringId || updatedFields?.offeringId === null) &&
                updatedFields?.offeringId !== rest?.offeringId
            }`,
        );
        if (updatedFields?.unenrollOffering) {
            await this.contractService.changeCustomerContract({
                customer: rest,
                subject: sub,
                businessID,
                unenrollOfferingId: updatedFields?.unenrollOffering,
            });
        }
        if (rest?.offeringIds && rest?.offeringIds.length >= 1) {
            if (updatedFields?.offeringId && !overridesForCustomer) {
                const found = rest.offeringIds.find((offeringId) => offeringId === updatedFields?.offeringId);
                if (found) {
                    throw new BadRequestException(
                        `Customer is already enrolled in offering ${updatedFields?.offeringId}`,
                    );
                }
            }
        }
        if (
            (updatedFields?.offeringId || updatedFields?.offeringId === null) &&
            updatedFields?.offeringId !== rest?.offeringId
        ) {
            const {
                freeTrialEndDate: newFreeTrialEndDate,
                freeTrialStartDate: contractFreeTrialStartDate,
                offeringEnrollmentDate,
                prepaidCredit,
            } = await this.contractService.changeCustomerContract({
                oldOfferingIds: rest?.offeringIds,
                newOfferingId: updatedFields?.offeringId,
                customer: rest,
                subject: sub,
                businessID,
                overridesForCustomer,
                usageOverrides: usage,
                removePriorOffering,
            });
            freeTrialEndDate = newFreeTrialEndDate;
            newOfferingEnrollmentDate = offeringEnrollmentDate;
            freeTrialStartDate = contractFreeTrialStartDate;
            if (prepaidCredit) {
                creditAmount = (parseFloat(creditAmount) + parseFloat(prepaidCredit)).toFixed(2).toString();
            }
        } else if (rest?.freeTrialEndDate) {
            freeTrialEndDate = rest?.freeTrialEndDate;
        }
        CustomerService.logger.log(
            `Comparision Check second If: ${
                updatedFields?.offeringId !== null &&
                updatedFields?.offeringId === rest?.offeringId &&
                rest?.offeringId &&
                overridesForCustomer
            } `,
        );
        if (
            updatedFields?.offeringId !== null &&
            (updatedFields?.offeringId === rest?.offeringId || updatedFields?.offeringId === undefined) &&
            rest?.offeringId &&
            overridesForCustomer
        ) {
            await this.contractService.update({
                businessID,
                offeringId: rest?.offeringId,
                customerId,
                overridesForOffering: overridesForCustomer,
            });
        }

        // break shouldCreateStripeCustomer into two parts because
        // 1. the 1st part is validating the input of the request
        // 2. the 2nd part below involves external calls which will create new entities in SaaS
        // business Stripe account. So we want to do internal processing of
        // offering first, making sure there is potential errors,
        // then call Stripe.
        let updatedStripeCustomerId;
        let portalUrl;
        if (shouldCreateStripeCustomer) {
            const { accountState } = settingsEntity;
            const results = await CustomerEntity.createStripeCustomer({
                customerName: updatedFields?.customerName ? updatedFields?.customerName : rest?.customerName,
                email: updatedFields?.email ? updatedFields?.email : rest?.email,
                businessStripeAccount,
                accountState,
            });
            updatedStripeCustomerId = results.stripeCustomerId;
            portalUrl = results.portalUrl;
        }

        const stripeCustomerId = shouldCreateStripeCustomer
            ? updatedStripeCustomerId
            : updatedFields?.paymentChannelOptions?.stripeCustomerId || rest?.paymentChannelOptions?.stripeCustomerId;

        CustomerService.logger.log(
            `Customer updatedFields Offering: ${updatedFields?.offeringId} Customer current offering: ${rest?.offeringId}`,
        );
        let removedOfferings = [];

        if (updatedFields?.unenrollOffering) {
            removedOfferings.push(updatedFields?.unenrollOffering);
        }
        if (updatedFields?.offeringId === null && rest?.offeringIds) {
            removedOfferings = removedOfferings.concat(rest?.offeringIds);
        }

        if (
            removePriorOffering &&
            updatedFields?.offeringId !== null &&
            updatedFields?.offeringId &&
            rest?.offeringIds &&
            !updatedFields?.unenrollOffering
        ) {
            removedOfferings = removedOfferings.concat(rest?.offeringIds);
        }
        const offeringIds = CustomerEntity.determineOfferingIdsArray({
            oldOfferingIds: rest?.offeringIds,
            newOfferingId: updatedFields?.offeringId,
            removedOfferings,
        });
        const customerEntity = new CustomerEntity({
            ...rest,

            ...updatedFields,
            offeringIds,
            offeringId: offeringIds ? offeringIds[0] : undefined,
            freeTrialEndDate,
            freeTrialStartDate:
                !rest?.freeTrialStartDate && freeTrialEndDate ? freeTrialStartDate : rest?.freeTrialStartDate,
            customerId,
            businessID,
            creditBalance: creditAmount,
            paymentChannelOptions: stripeCustomerId ? { stripeCustomerId: stripeCustomerId } : undefined,
            offeringEnrollmentDate: newOfferingEnrollmentDate
                ? newOfferingEnrollmentDate
                : rest?.offeringEnrollmentDate,
            metadata: joinMetadataObjectsAndRemoveNulls(rest?.metadata, updatedFields?.metadata),
        });
        CustomerService.logger.log('Customer Entity Offering ID', customerEntity.offeringId);
        const points = CustomerEntity.transformer(customerEntity, this.InfluxService);
        CustomerService.logger.debug(`Updating customer ${customerId} in business ${businessID}.`);

        await loadPoints(`${process.env.STAGE}-config`, process.env.INFLUX_ORG, points);
        WebhookPublishingService.publishEvent({
            topic: WebhookProcessorEventType.Standard,
            type: WebhookType.CUSTOMER_UPDATED,
            data: [new ReadCustomerResponseData(customerEntity)],
            businessID,
        });
        return { message: 'Customer updated added', customerId: customerId, portalUrl };
    }
    async getCustomerLedger({ businessID, customerId }): Promise<{ data: any[]; message: string }> {
        CustomerService.logger.log(`Getting ledger for customer ${customerId} of business ${businessID}`);
        const ledger = await this.InfluxService.getCustomerLedger({ businessID, customerId });
        return { data: ledger, message: 'Found Ledger for Customer' };
    }
    async updateFreeTrialEndDate({
        customerId,
        businessID,
        freeTrialEndDate,
        subject,
        freeTrialStartDate,
        offeringId,
    }: {
        customerId: string;
        businessID: string;
        freeTrialEndDate: string;
        subject: string;
        freeTrialStartDate?: string;
        offeringId?: string;
    }): Promise<UpdateFreeTrialResponseDto> {
        CustomerService.logger.debug(`Starting to update free trial end date for customer ${customerId}`);
        const {
            data: [{ ...customerObj }],
        } = await this.findOne({ customerId, businessID });
        customerObj.freeTrialEndDate = freeTrialEndDate;
        if (freeTrialStartDate) {
            customerObj.freeTrialStartDate = freeTrialStartDate;
        }
        CustomerService.logger.debug(`Before removal of the scheduled free trial job for customer ${customerId}`);
        try {
            await this.schedulerService.removeFreeTrialJob({ customerId, businessID });
        } catch (e) {
            if (e instanceof NotFoundException) {
                CustomerService.logger.warn(
                    `Failed to remove free trial job for customer ${customerId}. Could not find it`,
                );
            } else {
                CustomerService.logger.error(e);
                AuditService.publishEvent({
                    data: [serializeError(e)],
                    message: `Failed to update free trial end date for customer ${customerId}`,
                    topic: AuditScope.ERROR,
                });
                throw new InternalServerErrorException('Failed to update free trial end date try again');
            }
        }
        CustomerService.logger.debug(`After removal of the scheduled free trial job for customer ${customerId}`);
        try {
            await Offering.createFreeTrialJob({
                customerId,
                businessID,
                msBetweenNowAndFreeTrialEndDate: new Date(freeTrialEndDate).getTime() - new Date().getTime(),
                schedulerService: this.schedulerService,
                subject,
                offeringId: offeringId ? offeringId : customerObj.offeringIds[0],
            });
        } catch (e) {
            CustomerService.logger.error(e);
            AuditService.publishEvent({
                data: [serializeError(e)],
                message: `Failed to update free trial end date for customer ${customerId}`,
                topic: AuditScope.ERROR,
            });
            throw new InternalServerErrorException('Failed to update free trial end date try again');
        }
        await this.contractService.update({
            customerId,
            offeringId: offeringId ? offeringId : customerObj.offeringIds[0],
            businessID,
            overridesForOffering: { freeTrialEndDate },
        });
        return { message: 'Free trial end date updated', customerId: customerId };
    }
    async findUsageForCustomer(
        { businessID, customerId, customer }: ReadUsageForCustomerDto,
        overrides: QueryParamUsageDto,
    ): Promise<ReadCustomerUsageData> {
        CustomerService.logger.log('Getting Usage for a customer', { businessID, customerId });
        if (!overrides?.aggregationPurpose) {
            overrides.aggregationPurpose = AggregationPurpose.BILLING;
        }
        const usageDoc = await this.usageService.findUsageForCustomer({ customerId, businessID, customer }, overrides);
        let offeringEnrollmentDateMap;
        if (customer?.enrollments && customer?.enrollments.length > 0) {
            offeringEnrollmentDateMap = customer?.enrollments.reduce(
                (acc, { offering: { offeringId }, offeringEnrollmentDate }) => {
                    acc[offeringId] = offeringEnrollmentDate;
                    return acc;
                },
                {},
            );
        } else if (customer?.offeringEnrollmentDate) {
            offeringEnrollmentDateMap = { [customer?.offeringIds[0]]: customer?.offeringEnrollmentDate };
        } else {
            const {
                data: [{ offeringEnrollmentDate: readOfferingEnrollmentDate, enrollments, offeringIds }],
            } = await this.findOne({ customerId, businessID });
            if (enrollments && enrollments.length > 0) {
                offeringEnrollmentDateMap = enrollments.reduce(
                    (acc, { offering: { offeringId }, offeringEnrollmentDate }) => {
                        acc[offeringId] = offeringEnrollmentDate;
                        return acc;
                    },
                    {},
                );
            } else {
                offeringEnrollmentDateMap = { [offeringIds[0]]: readOfferingEnrollmentDate };
            }
        }
        let filteredDocs;
        if (
            (offeringEnrollmentDateMap && !overrides?.ignoreEnrollmentDate) ||
            overrides?.ignoreEnrollmentDate === 'false'
        ) {
            filteredDocs = usageDoc.map(({ usage, ...rest }) => {
                const offeringEnrollmentDate = offeringEnrollmentDateMap[rest.offeringId];
                return {
                    ...rest,
                    usage: this.filterUsageForCustomerOfferingEnrollmentDate({
                        offeringEnrollmentDate,
                        usageArray: usage,
                    }),
                } as AggregatedUsageResponse | UnAggregatedUsageResponse;
            });
        } else {
            filteredDocs = usageDoc;
        }
        if (usageDoc?.length > 0) {
            return {
                data: filteredDocs,
                message: 'Found usage',
            };
        } else {
            return { data: [], message: 'No Customer usage found' };
        }
    }
    filterUsageForCustomerOfferingEnrollmentDate({
        offeringEnrollmentDate,
        usageArray,
    }: {
        offeringEnrollmentDate: string;
        usageArray: BasicUsageDocument[] | UsageResponseDocument[];
    }): BasicUsageDocument[] | UsageResponseDocument[] {
        if (usageArray && usageArray.length > 0) {
            if ((usageArray[0] as UsageResponseDocument).startTime) {
                const usageResponseArray = usageArray as UsageResponseDocument[];
                return usageResponseArray.map((usageDoc) => {
                    if (new Date(usageDoc.endTime).getTime() >= new Date(offeringEnrollmentDate).getTime()) {
                        return usageDoc;
                    } else {
                        return {
                            ...usageDoc,
                            value: '0',
                        };
                    }
                });
            } else {
                const basicUsageArray = usageArray as BasicUsageDocument[];
                return basicUsageArray
                    .map((usageDoc) => {
                        if (new Date(usageDoc.timestamp).getTime() >= new Date(offeringEnrollmentDate).getTime()) {
                            return usageDoc;
                        } else {
                            return undefined;
                        }
                    })
                    .filter((e) => e);
            }
        } else {
            return [];
        }
    }
    async createSaaSCustomerToken({ customerId, businessID }): Promise<CustomerAuthenticationTokenResponse> {
        await this.findOne({ customerId, businessID });
        const { access_token } = await this.localJWTAuthService.signIn(customerId, businessID);

        return { access_token };
    }
    async evaluateEntitlementsForCustomer(
        customer: ReadCustomerResponseData,
        businessID: string,
    ): Promise<
        {
            dimensionId: string;
            usageAmount: number;
            entitlementAmount: number;
            isEntitled: boolean;
            percentageUtilized?: number;
            customerId: string;
            email: string;
            customerName: string;
        }[]
    > {
        let offering;
        if (customer?.offering && Array.isArray(customer?.offering) && customer?.offering?.length > 1) {
            // TODO: ISSUE-1001 handle multi-offering entitlements - Can punt
            return [];
        } else if (customer?.offering && Array.isArray(customer?.offering) && customer?.offering?.length === 1) {
            const offering = customer?.offering[0];
        } else if (customer?.offering) {
            offering = customer?.offering;
        } else {
            return [];
        }
        const { currentBillingCycleStartTime: startTime } = Billing.billingCycleToTimeRange(offering?.billingCycle);
        const endTime = new Date().toISOString();
        const { data } = await this.findUsageForCustomer(
            { customerId: customer?.customerId, customer, businessID },
            { startTime, endTime, aggregationPurpose: AggregationPurpose.METERING },
        );
        const aggregatedUsage = data as AggregatedUsageResponse[];
        const dimensionEntitlements = aggregatedUsage.map(({ usage, dimensionId }) => {
            const dimension = offering?.dimensions.find(({ dimensionId }) => dimensionId === dimensionId);

            if (dimension?.usageEntitlement !== undefined && dimension?.usageEntitlement !== 'inf') {
                const usageAmount = usage.reduce((acc, { value }) => acc + parseFloat(value), 0);

                return {
                    dimensionId,
                    usageAmount,
                    entitlementAmount: dimension?.usageEntitlement,
                    isEntitled: usageAmount <= dimension?.usageEntitlement,
                    percentageUtilized: dimension?.usageEntitlement
                        ? (usageAmount / dimension?.usageEntitlement) * 100
                        : undefined,
                    customerId: customer?.customerId,
                    email: customer?.email,
                    customerName: customer?.customerName,
                };
            } else {
                return;
            }
        });
        return dimensionEntitlements.filter((e) => e);
    }
    async refund({
        customerId,
        businessID,
        amount,
        reason,
        refundChannelOptions,
    }: {
        customerId: string;
        businessID: string;
        amount?: string;
        reason?: string;
        paymentIntentId?: string;
        refundChannelOptions: StripeRefundChannelOptions;
    }) {
        const {
            data: [{ paymentChannel, paymentChannelOptions }],
        } = await this.findOne({ customerId, businessID });

        if (paymentChannel === PaymentChannel.Stripe) {
            const [{ stripeAccountId, accountState }] = await this.settingsService.findAll({ businessID });
            if (!stripeAccountId) {
                throw new ConflictException(
                    'Stripe Connect not enabled. Please enable Stripe Connect in Dashboard settings in order to access customer portal.',
                );
            }
            if (!paymentChannelOptions?.stripeCustomerId) {
                throw new ConflictException(
                    'Stripe Customer needs to have a stripe customerId in order to refund correctly',
                );
            }
            await StripePaymentProcessor.processStripeRefund({
                stripeAccountId,
                stripeCustomerId: paymentChannelOptions?.stripeCustomerId,
                amount,
                reason: (reason ? reason : 'requested_by_customer') as string,
                accountState,
                ...refundChannelOptions,
            });
            return { message: 'Refund processed successfully' };
        } else {
            throw new BadRequestException(
                `Refunds not supported for current customer payment channel: ${paymentChannel}`,
            );
        }
    }
    async findRefunds({
        customerId,
        businessID,
        paymentChannel,
        paymentChannelOptions,
        stripeAccountId,
        accountState,
    }: {
        customerId: string;
        businessID: string;
        paymentChannel?: PaymentChannel;
        paymentChannelOptions?: StripePaymentChannelOptions;
        stripeAccountId?: string;
        accountState?: AccountState;
    }): Promise<{ data: StripeRefundResponseDto[]; messages: string }> {
        let setPaymentChannel;
        let setPaymentChannelOptions;
        if (paymentChannel && paymentChannelOptions) {
            setPaymentChannel = paymentChannel;
            setPaymentChannelOptions = paymentChannelOptions;
        } else {
            const res = await this.findOne({ customerId, businessID });
            setPaymentChannel = res?.data[0]?.paymentChannel;
            setPaymentChannelOptions = res?.data[0]?.paymentChannelOptions;
        }
        if (setPaymentChannel === PaymentChannel.Stripe) {
            if (!stripeAccountId || !accountState) {
                const [{ stripeAccountId: businessStripeAccount, accountState: businessAccountState }] =
                    await this.settingsService.findAll({
                        businessID,
                    });
                stripeAccountId = businessStripeAccount;
                accountState = businessAccountState;
            }
            if (!stripeAccountId || !setPaymentChannelOptions?.stripeCustomerId) {
                return { data: [], messages: 'Stripe not connected or Stripe customer ID not set' };
            }
            try {
                const results = await StripePaymentProcessor.getRefundsForCustomer({
                    stripeCustomerId: paymentChannelOptions?.stripeCustomerId,
                    accountState,
                    stripeAccountId,
                });
                return { data: results, messages: 'Found refunds' };
            } catch (e) {
                CustomerService.logger.warn(e.statusCode === 404 ? 'Stripe customer not found' : e.message);
                return { data: [], messages: 'Stripe customer not found' };
            }
        } else {
            return { data: [], messages: 'No manual refunds found' };
        }
    }

    async findPayments({
        customerId,
        businessID,
        paymentChannel,
        paymentChannelOptions,
        invoiceId,
        stripeAccountId,
        accountState,
    }: {
        customerId: string;
        businessID: string;
        paymentChannel?: PaymentChannel;
        paymentChannelOptions?: StripePaymentChannelOptions;
        invoiceId?: string;
        stripeAccountId?: string;
        accountState?: AccountState;
    }): Promise<{ data: StripePaymentResponseDto[]; messages: string }> {
        CustomerService.logger.debug(
            `Finding Payments for customer ${customerId} of business ${businessID}, invoiceId: ${invoiceId}`,
        );
        let setPaymentChannel;
        let setPaymentChannelOptions;
        if (paymentChannel && paymentChannelOptions) {
            setPaymentChannel = paymentChannel;
            setPaymentChannelOptions = paymentChannelOptions;
        } else {
            const res = await this.findOne({ customerId, businessID });
            setPaymentChannel = res?.data[0]?.paymentChannel;
            setPaymentChannelOptions = res?.data[0]?.paymentChannelOptions;
        }
        if (setPaymentChannel === PaymentChannel.Stripe) {
            if (!stripeAccountId || !accountState) {
                const [{ stripeAccountId: businessStripeAccount, accountState: businessAccountState }] =
                    await this.settingsService.findAll({
                        businessID,
                    });
                stripeAccountId = businessStripeAccount;
                accountState = businessAccountState;
            }
            if (!stripeAccountId || !setPaymentChannelOptions?.stripeCustomerId) {
                return { data: [], messages: 'Stripe not connected or Stripe customer ID not set' };
            }
            try {
                const results = await StripePaymentProcessor.getPaymentsForCustomer({
                    stripeCustomerId: setPaymentChannelOptions?.stripeCustomerId,
                    accountState,
                    stripeAccountId,
                    metadata: invoiceId ? { invoiceId } : undefined,
                });
                CustomerService.logger.debug(`Found ${results.length} payments for customer ${customerId}`);
                return { data: results, messages: 'Found payments' };
            } catch (e) {
                CustomerService.logger.warn(e.statusCode === 404 ? 'Stripe customer not found' : e.message);
                return { data: [], messages: 'Stripe customer not found' };
            }
        } else {
            return { data: [], messages: 'No manual payments found' };
        }
    }

    async getStripePortalUrl({ customerId, businessID }): Promise<GetCustomerStripePortalResponse> {
        const {
            data: [{ paymentChannel, paymentChannelOptions }],
        } = await this.findOne({ customerId, businessID });

        if (paymentChannel === PaymentChannel.Stripe) {
            if (!paymentChannelOptions?.stripeCustomerId) {
                throw new ConflictException('Unable to get Stripe portal URL: missing Stripe customer ID.');
            }
            const [{ stripeAccountId: businessStripeAccount, accountState }] = await this.settingsService.findAll({
                businessID,
            });
            if (!businessStripeAccount) {
                throw new ConflictException(
                    'Stripe Connect not enabled. Please enable Stripe Connect in Dashboard settings in order to access customer portal.',
                );
            }

            try {
                await CustomerEntity.getStripeCustomer(
                    paymentChannelOptions?.stripeCustomerId,
                    businessStripeAccount,
                    accountState,
                );
            } catch (e) {
                CustomerService.logger.warn(e.statusCode === 404 ? 'Stripe customer not found' : e.message);
                throw new ConflictException('Stripe customer not found');
            }
            try {
                const url = await CustomerEntity.getStripeCustomerPortalUrl(
                    paymentChannelOptions?.stripeCustomerId,
                    businessStripeAccount,
                    accountState,
                );
                return { portalUrl: url, message: 'Generated portal URL' };
            } catch (e) {
                throw new BadRequestException(e.message);
            }
        } else {
            throw new BadRequestException(`Customer requested is not using Stripe payment channel: ${paymentChannel}`);
        }
    }
}
