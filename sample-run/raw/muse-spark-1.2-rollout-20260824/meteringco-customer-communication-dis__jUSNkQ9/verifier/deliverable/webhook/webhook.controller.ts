import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Post,
    Query,
    Req,
    UnauthorizedException,
    UseGuards,
} from '@nestjs/common';
import { WebhookService } from './webhook.service.js';
import { randomUUID } from 'crypto';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExtraModels, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthorizedRequest } from '../authz/jwt-local.gaurd.js';
import { CreateWebhookDto, WebhookType } from './dto/create-webhook.dto.js';
import { EntitlementWebookParameters } from './entities/webhook.entity.js';
import { CreateInvoiceResponseDto } from '../invoice/dto/create-Invoices.dto.js';
import { ReadInvoicesDto } from '../invoice/dto/read-invoices.dto.js';
import { InvoiceStatus } from '../invoice/entities/InvoiceStatus.js';
import { InvoicePaymentTerm } from '../invoice/entities/InvoicePaymentTerm.js';
import { SupportedCurrencies } from '../offering/dto/SupportedCurrencies.js';
import { ReadCustomerResponseData } from '../customer/entities/customer.entity.js';
import { paymentChannel } from '../customer/dto/create-customer.dto.js';
import { ReadContractResponseDto } from '../contract/dto/readContract.dto.js';
import { ContractEntity } from '../contract/entities/contract.entity.js';
import { Offering, UsageBased } from '../offering/entities/offeringPackage.entity.js';
import { ReadOfferingResponseData } from '../offering/dto/readOffering.dto.js';
import { InvoicesService } from '../invoice/invoices.service.js';
import { OfferingType } from '../offering/entities/OfferingType.js';
import { countBasedUnits, roundingEnum } from '../dimensions/dto/create-dimension.dto.js';

@ApiBearerAuth('bearer')
@ApiExtraModels(CreateInvoiceResponseDto, ReadInvoicesDto, EntitlementWebookParameters)
@Controller('webhooks')
@ApiTags('Webhooks')
export class WebhookController {
    constructor(
        private readonly webhookService: WebhookService,
        private readonly invoicesService: InvoicesService,
    ) {}

    @ApiOperation({ operationId: 'Test Webhook Connection' })
    @UseGuards(AuthGuard('jwt'))
    @Get('test')
    test(): { id: string; name: string }[] {
        return [{ id: randomUUID(), name: 'test' }];
    }

    @ApiOkResponse({
        status: 200,
        description: 'OK',
        schema: {
            oneOf: [
                {
                    type: CreateInvoiceResponseDto.name,
                    items: {
                        $ref: '#/components/schemas/CreateInvoiceResponseDto',
                    },
                },
                { type: ReadInvoicesDto.name, items: { $ref: '#/components/schemas/ReadInvoicesDto' } },
            ],
        },

        isArray: true,
    })
    @ApiOperation({ operationId: 'Test Webhook Invoices' })
    @UseGuards(AuthGuard('jwt'))
    @Get('invoice')
    invoiceCreated(@Query('status') status: string): CreateInvoiceResponseDto[] | ReadInvoicesDto[] {
        if (status === InvoiceStatus.DRAFT) {
            return [{ invoiceId: randomUUID(), message: 'Generated invoice' }];
        } else if (status === InvoiceStatus.PAID) {
            const invoiceId = randomUUID();
            // eslint-disable-next-line
            // @ts-ignore
            const invoice: ReadInvoicesDto = {
                invoiceId,
                invoicePaymentTerm: InvoicePaymentTerm.net30,
                invoiceStatus: InvoiceStatus.PAID,
                invoiceDate: new Date().toISOString(),
                totalAmountWithoutTax: 100,
                taxAmount: 10,
                lineItems: [
                    {
                        name: 'Test Item',
                        quantity: 1,
                        unitCost: 110,
                    },
                ],
                currency: SupportedCurrencies.USD,
            };
            return [invoice];
        } else {
            return [];
        }
    }
    @ApiOperation({ operationId: 'Test Webhook Invoices' })
    @UseGuards(AuthGuard('jwt'))
    @Get('customer')
    findCustomerTest(): ReadCustomerResponseData[] {
        const customerId = randomUUID();
        const offeringId = randomUUID();
        return [
            new ReadCustomerResponseData(
                {
                    customerId,
                    email: 'test@email.com',
                    customerName: 'Test Customer',
                    paymentChannel: paymentChannel.manual,
                    address: {
                        state: 'CA',
                        countryCode: 'us',
                        city: 'San Francisco',
                        postalCode: '94105',
                        streetLineOne: '123 Main Street',
                        streetLineTwo: 'Apt 1',
                    },
                    currency: SupportedCurrencies.USD,
                },
                [],
                new ReadContractResponseDto(
                    new ContractEntity(
                        {
                            offeringType: OfferingType.usageBased,
                            offeringName: 'Test Offering',
                            offeringId,
                            businessID: 'test',
                            customerId,
                            dimensions: [
                                {
                                    dimensionId: randomUUID(),
                                    dimensionName: 'Test dimension name',
                                    usageIncrement: '1',
                                    rounding: roundingEnum.ceiling,
                                    consumptionUnit: {
                                        unit: countBasedUnits['count-based'],
                                        type: 'count',
                                    },
                                },
                            ],
                        } as Offering,
                        {
                            customerId,
                            offeringId,
                            businessID: 'test',
                            offeringEnrollmentDate: new Date().toISOString(),
                        },
                    ),
                    {
                        offeringId,
                        offeringName: 'Test Offering',
                        currency: SupportedCurrencies.USD,
                        dimensions: [
                            {
                                dimensionId: randomUUID(),
                                dimensionName: 'Test dimension name',
                                usageIncrement: '1',
                                rounding: roundingEnum.ceiling,
                                consumptionUnit: {
                                    unit: countBasedUnits['count-based'],
                                    type: 'count',
                                },
                            },
                        ],
                    } as ReadOfferingResponseData,
                ),
            ),
        ];
    }
    @ApiOperation({ operationId: 'Test Webhook Entitlement Breached' })
    @UseGuards(AuthGuard('jwt'))
    @Get('entitlement')
    entitlmentBreached(): EntitlementWebookParameters[] {
        const webhookParams: EntitlementWebookParameters = {
            timestamp: new Date().toISOString(),
            dimensionId: randomUUID(),
            customerId: randomUUID(),
            entitlementLimit: '100',
            email: 'noreply@meteringco.example',
            eventType: 'usageEntitlementLimitReached',
            currentUsageTotal: '100',
            customerName: 'Test Customer',
            webhookType: WebhookType.ENTITLEMENT,
        };
        return [webhookParams];
    }
    @ApiOperation({ operationId: 'Find All Webhooks' })
    @UseGuards(AuthGuard('jwt'))
    @Get()
    findAll(@Req() request: AuthorizedRequest) {
        if (request?.user?.businessID) {
            const {
                user: { businessID },
            } = request;
            return this.webhookService.findAll({ businessID });
        } else {
            throw new UnauthorizedException();
        }
    }
    @ApiOperation({ operationId: 'Find One Webhook' })
    @UseGuards(AuthGuard('jwt'))
    @Get(':webhookId')
    findOne(@Req() request: AuthorizedRequest, @Param('webhookId') webhookId: string) {
        if (request?.user?.businessID) {
            const {
                user: { businessID },
            } = request;
            return this.webhookService.findOne({ businessID, webhookId });
        } else {
            throw new UnauthorizedException();
        }
    }

    @ApiOperation({ operationId: 'Subscribe a Webhook' })
    @UseGuards(AuthGuard('jwt'))
    @Post('subscribe')
    subscribe(@Req() request: AuthorizedRequest, @Body() createWebhookDto: CreateWebhookDto) {
        if (request?.user?.businessID) {
            const {
                user: { businessID, sub },
            } = request;
            return this.webhookService.subscribe({ ...createWebhookDto, businessID }, sub);
        } else {
            throw new UnauthorizedException();
        }
    }
    @ApiOperation({ operationId: 'Unsubscribe a Webhook' })
    @UseGuards(AuthGuard('jwt'))
    @Delete(':webhookId')
    unsubscribe(
        @Req() request: AuthorizedRequest,
        @Param('webhookId') webhookId: string,
        @Query('environment') environment: string,
    ) {
        if (request?.user?.businessID) {
            const {
                user: { sub },
            } = request;
            return this.webhookService.unsubscribe({ subject: sub, webhookId, environment });
        } else {
            throw new UnauthorizedException();
        }
    }
}
