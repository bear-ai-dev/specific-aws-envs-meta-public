import {
    BadRequestException,
    Body,
    Controller,
    Get,
    HttpRedirectResponse,
    Logger,
    Param,
    Post,
    Put,
    Query,
    Req,
    Res,
    UseGuards,
} from '@nestjs/common';
import { AuthorizedRequest, AuthorizedRequestWithInvoiceId, LocalJWTAuthGuard } from '../authz/jwt-local.gaurd.js';
import { CustomerService } from '../customer/customer.service.js';
import { PortalService } from './portal.service.js';
import {
    ApiBadRequestResponse,
    ApiCreatedResponse,
    ApiExtraModels,
    ApiNotFoundResponse,
    ApiOkResponse,
    ApiOperation,
    ApiTags,
} from '@nestjs/swagger';
import { ConfigurationResponse, PortalPagesConfigurationDto } from './dto/configuration.dto.js';
import { CustomerBillingResponse } from './dto/customer.dto.js';
import { ListInvoicesResponse } from './dto/list-invoices.dto.js';
import { ReadSingleInvoiceResponse } from './dto/single-invoice.dto.js';
import { UsageOfCurrentBillingCycle } from './dto/usage.dto.js';
import {
    customerNotFoundResponseSchema,
    GetCustomerStripePortalResponse,
    QueryParamUsageDto,
} from '../customer/dto/read-customer.dto.js';
import { BasicResponseDTO } from '../basicResponseDTO.js';
import { UpdatePortalCustomerDto, UpdateCustomerResponseDto } from './dto/update-customer.dto.js';
import { AuthGuard } from '@nestjs/passport';
import {
    AppearanceOfferingPortalDto,
    CTAOfferingPortalDto,
    FeaturedOfferingPortalDto,
    PortalOfferingPageDto,
    PricingTableOfferingPortalDto,
} from './dto/PortalOfferingPageDto.js';
import { BusinessTokenAuthenticationResponse } from './dto/businessTokenAuthenticationResponse.dto.js';
import { LocalJWTAuthService } from '../authz/jwt-local.strategy.js';
import { CreateCustomerOnboarding, CreateCustomerOnboardingResponse } from './dto/createCustomerOnboarding.dto.js';
import { PortalUsageQueryParamDto } from './dto/portalUsageQueryParam.dto.js';
import { PaymentSessionResponse } from './dto/paymentSessionResponst.dto.js';
import { PaymentStatus } from '../payment/payment.service.js';
import { Response } from 'express';
import { InvoicesService } from '../invoice/invoices.service.js';
import { InvoiceStatus } from '../invoice/entities/InvoiceStatus.js';

@Controller('portal')
@ApiTags('Portal')
@ApiExtraModels(PortalOfferingPageDto)
@ApiExtraModels(AppearanceOfferingPortalDto)
@ApiExtraModels(CTAOfferingPortalDto)
@ApiExtraModels(FeaturedOfferingPortalDto)
@ApiExtraModels(PricingTableOfferingPortalDto)
export class PortalController {
    private static readonly logger = new Logger(PortalController.name);
    constructor(
        readonly customerService: CustomerService,
        readonly portalService: PortalService,
        readonly localJWTAuthService: LocalJWTAuthService,
        readonly invoicesService: InvoicesService,
    ) {}

    /**
     * Get a token to allow a SaaS business to display their checkout page securely
     */
    @ApiOkResponse({
        status: 200,
        description: 'OK',
        type: BusinessTokenAuthenticationResponse,
    })
    @UseGuards(AuthGuard('jwt'))
    @Post('/token')
    @ApiOperation({ operationId: 'Get a business auth token' })
    getSaaSCustomerToken(@Req() request: AuthorizedRequest): Promise<BusinessTokenAuthenticationResponse> {
        const { businessID, sub } = request.user;
        return this.localJWTAuthService.signInBusiness(sub, businessID);
    }

    @ApiCreatedResponse({
        status: 201,
        description: 'Customer Created',
        type: CreateCustomerOnboardingResponse,
    })
    @Post('/customer')
    @ApiOperation({ operationId: 'Create a customer' })
    @UseGuards(LocalJWTAuthGuard)
    createCustomerCheckout(
        @Req() request: AuthorizedRequest,
        @Body() createCustomerOnboardingDto: CreateCustomerOnboarding,
    ) {
        const { businessID, sub } = request.user;
        return this.portalService.createCustomer({ ...createCustomerOnboardingDto, businessID }, sub);
    }
    @ApiOkResponse({
        status: 200,
        description: 'OK',
        type: UsageOfCurrentBillingCycle,
    })
    @UseGuards(LocalJWTAuthGuard)
    @Get('/customer/usage')
    @ApiOperation({ operationId: 'Get customer usage for current billing cycle' })
    findDashboard(@Req() request: AuthorizedRequest, @Query() query: PortalUsageQueryParamDto) {
        const { businessID, sub } = request.user;
        return this.portalService.findUsageOfCurrentBillingCycle(businessID, sub, query);
    }

    @UseGuards(LocalJWTAuthGuard)
    @Get('/customer/payment')
    @ApiOperation({ operationId: 'Get Payment Session for a customer' })
    async findPaymentSession(
        @Req() request: AuthorizedRequestWithInvoiceId,
        @Query('paymentStatus') paymentStatus: PaymentStatus,
        @Query('sessionId') sessionId: string,
        @Res() response: Response,
    ) {
        PortalController.logger.log('findPaymentSession request started');
        const { businessID, sub, invoiceId } = request.user;
        if (paymentStatus) {
            PortalController.logger.log(`findPaymentSession request started with paymentStatus: ${paymentStatus}`);
            // Return a basic HTML string to display to the user
            if (paymentStatus === PaymentStatus.success) {
                await this.portalService.handlePaymentSucess({ businessID, customerId: sub, invoiceId, sessionId });
                PortalController.logger.log('findPaymentSession request ended');
                response.setHeader('Content-Type', 'text/html');
                response.send(
                    '<!DOCTYPE html><html><body><h1>Sucessfully Paid. Please close this Tab and go back to your previous tab.</h1></body></html>',
                );
                PortalController.logger.log('findPaymentSession response sent');
                return;
            }
        }
        PortalController.logger.log('Payment status not found, creating a new session');
        const { data: invoiceRes } = await this.invoicesService.findOne(businessID, invoiceId, 'false');
        if (invoiceRes && invoiceRes.length > 0 && invoiceRes[0].invoiceStatus === InvoiceStatus.PAID) {
            response.setHeader('Content-Type', 'text/html');
            response.send(
                '<!DOCTYPE html><html><body><h1>Already Paid Invoice. Please close this Tab and go back to your previous tab. </h1></body></html>',
            );
            return;
        }
        const { url, paymentCompleted } = await this.portalService.getPaymentSession(
            businessID,
            sub,
            invoiceId,
            invoiceRes,
        );
        if (paymentCompleted) {
            response.setHeader('Content-Type', 'text/html');
            response.send(
                '<!DOCTYPE html><html><body><h1>Already Paid Invoice. Please close this Tab and go back to your previous tab. </h1></body></html>',
            );
            return;
        }
        if (url === '') {
            throw new BadRequestException(`Payment session url not generated for invoice ${invoiceId}`);
        }
        const redirectResponse: HttpRedirectResponse = {
            url,
            statusCode: 302,
        };
        return response.redirect(redirectResponse.statusCode, redirectResponse.url);
    }

    @ApiOkResponse({
        status: 200,
        description: 'OK',
        type: CustomerBillingResponse,
    })
    @UseGuards(LocalJWTAuthGuard)
    @Get('/customer')
    @ApiOperation({ operationId: 'Get customer information' })
    findCustomer(@Req() request: AuthorizedRequest) {
        const { businessID, sub } = request.user;
        return this.portalService.findCustomer(businessID, sub);
    }

    @ApiOkResponse({
        status: 200,
        description: 'OK',
        type: UpdateCustomerResponseDto,
    })
    @ApiBadRequestResponse({
        status: 400,
        description: 'Bad Request',
        type: BasicResponseDTO,
    })
    @ApiNotFoundResponse(customerNotFoundResponseSchema)
    @UseGuards(LocalJWTAuthGuard)
    @Put('/customer')
    @ApiOperation({ operationId: 'Update customer' })
    updateCustomer(@Req() request: AuthorizedRequest, @Body() updateCustomerDto: UpdatePortalCustomerDto) {
        const { businessID, sub } = request.user;
        return this.portalService.updateCustomer(businessID, sub, updateCustomerDto);
    }

    @ApiOkResponse({
        status: 200,
        description: 'Stripe portal url generated',
        type: GetCustomerStripePortalResponse,
    })
    @ApiBadRequestResponse({
        status: 400,
        description: 'Bad Request',
        type: BasicResponseDTO,
    })
    @ApiOperation({ operationId: 'Get Stripe Portal for customer' })
    @UseGuards(LocalJWTAuthGuard)
    @Get('/customer/stripePortal')
    getStripePortalUrl(@Req() request: AuthorizedRequest) {
        const { businessID, sub } = request.user;
        return this.portalService.getStripePortalUrl(businessID, sub);
    }

    @ApiOkResponse({
        status: 200,
        description: 'OK',
        type: ReadSingleInvoiceResponse,
    })
    @UseGuards(LocalJWTAuthGuard)
    @Get('/invoices/:invoiceId')
    @ApiOperation({ operationId: 'Get detailed invoice' })
    findInvoice(
        @Req() request: AuthorizedRequest,
        @Param('invoiceId') invoiceId: string,
        @Query('download') download = 'false',
    ) {
        const { businessID, sub } = request.user;
        return this.portalService.findInvoice({ businessID, customerId: sub, invoiceId, download });
    }

    @ApiOkResponse({
        status: 200,
        description: 'OK',
        type: ListInvoicesResponse,
    })
    @UseGuards(LocalJWTAuthGuard)
    @Get('/invoices')
    @ApiOperation({ operationId: 'Get list of invoices for specified SaaS customer' })
    findInvoices(@Req() request: AuthorizedRequest) {
        const { businessID, sub } = request.user;
        return this.portalService.findInvoices(businessID, sub);
    }

    @ApiOkResponse({
        status: 200,
        description: 'OK',
        type: ConfigurationResponse,
    })
    @UseGuards(LocalJWTAuthGuard)
    @Get('/configuration')
    @ApiOperation({ operationId: 'Get portal configuration' })
    findConfiguration(@Req() request: AuthorizedRequest) {
        const { businessID } = request.user;
        return this.portalService.findConfiguration(businessID);
    }
    @ApiOkResponse({
        status: 200,
        description: 'OK',
        type: ConfigurationResponse,
    })
    @UseGuards(AuthGuard('jwt'))
    @Put('/configuration')
    @ApiOperation({ operationId: 'Update portal configuration' })
    updateConfiguration(@Req() request: AuthorizedRequest, @Body() body: PortalPagesConfigurationDto) {
        const { businessID, sub } = request.user;
        return this.portalService.updateConfiguration({ businessID, subject: sub, pages: body?.pages });
    }
}
