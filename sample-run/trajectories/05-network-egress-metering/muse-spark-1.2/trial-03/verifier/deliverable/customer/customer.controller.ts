import {
    Controller,
    Get,
    Post,
    Body,
    Param,
    Delete,
    Req,
    UseGuards,
    Put,
    NotFoundException,
    Query,
    forwardRef,
    Inject,
    Logger,
    BadRequestException,
    UseInterceptors,
} from '@nestjs/common';
import { CustomerService } from './customer.service.js';
import { CreateCustomerDto, CreateCustomerResponseDto } from './dto/create-customer.dto.js';
import { Request } from 'express';
import {
    ApiAcceptedResponse,
    ApiBadRequestResponse,
    ApiBearerAuth,
    ApiCreatedResponse,
    ApiExtraModels,
    ApiNotFoundResponse,
    ApiOkResponse,
    ApiOperation,
    ApiParam,
    ApiTags,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { UpdateCustomerDto } from './dto/update-customer.dto.js';
import { BasicResponseDTO } from '../basicResponseDTO.js';
import {
    AggregatedUsageResponse,
    CreateCustomerRefundResponse,
    customerNotFoundResponseSchema,
    FindCustomerPaymentsResponse,
    FindCustomerRefundsResponse,
    GetCustomerStripePortalResponse,
    QueryParamUsageDto,
    ReadAllCustomerResponseDTO,
    ReadCustomerResponseDTO,
    ReadCustomerUsageData,
    UnAggregatedUsageResponse,
} from './dto/read-customer.dto.js';
import { CustomerAuthenticationTokenResponse } from './dto/get-customer-auth.dto.js';
import { CreateCustomerRefundDto } from './dto/create-customer-refund.dto.js';
import { FindPaymentsQueryParamDto } from './dto/find-payments-query-param.dto.js';
import { StripeRefundResponseDto } from '../payment/dto/stripeRefundResponse.dto.js';
import { StripePaymentResponseDto } from '../payment/dto/stripePaymentResponse.dto.js';
import { UpdateFreeTrialDto, UpdateFreeTrialResponseDto } from './dto/updateFreeTrial.dto.js';
import { AuthorizedRequest } from '../authz/jwt-local.gaurd.js';
import { CustomOverrides } from '../contract/dto/prepareContractResponse.dto.js';
import { ContractService } from '../contract/contract.service.js';
import { UpdateCustomerEnrollmentDto } from './dto/updateCustomerEnrollment.dto.js';
import { CustomerContractDiscount } from '../contract/dto/customerContractDiscount.js';
import { CustomerEnrollmentResponseDto } from '../contract/dto/readContract.dto.js';
import { DeleteCustomerResponseDto } from './dto/deleteCustomerResponse.dto.js';
import { UsageService } from '../usage/usage.service.js';
import { TokenRegisterInterceptor } from '../interceptors/tokenRegisterInterceptor.js';
import { CustomerGroupService } from '../customergroup/customergroup.service.js';
import { CreateChildRowDto } from '../customergroup/dto/createCustomerGroup.dto.js';

@ApiBearerAuth('bearer')
@Controller('customers')
@ApiTags('Customers')
@ApiExtraModels(UnAggregatedUsageResponse)
@ApiExtraModels(AggregatedUsageResponse)
@ApiExtraModels(StripeRefundResponseDto)
@ApiExtraModels(StripePaymentResponseDto)
@ApiExtraModels(CustomOverrides)
@ApiExtraModels(CustomerContractDiscount)
export class PublicAPICustomerController {
    private static readonly logger = new Logger(PublicAPICustomerController.name);
    constructor(
        readonly customerService: CustomerService,
        @Inject(forwardRef(() => ContractService)) readonly contractService: ContractService,
        @Inject(forwardRef(() => UsageService)) readonly usageService: UsageService,
        @Inject(forwardRef(() => CustomerGroupService)) readonly customerGroupService: CustomerGroupService,
    ) {}

    /**
     * List all customers created in this account
     */
    @ApiOkResponse({
        status: 200,
        description: 'OK',
        type: ReadAllCustomerResponseDTO,
    })
    @ApiBadRequestResponse({
        status: 400,
        description: 'Bad Request',
        type: BasicResponseDTO,
    })
    @ApiOperation({ operationId: 'Get all Customers' })
    @UseGuards(AuthGuard('jwt'))
    @UseInterceptors(TokenRegisterInterceptor)
    @Get()
    findAll(@Req() request: Request) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-ignore
        const { businessID } = request.user;
        return this.customerService.findAll({ businessID });
    }
    /**
     * Assign a child to a customer
     */
    @ApiCreatedResponse({
        status: 201,
        description: 'Child Added',
        type: BasicResponseDTO,
    })
    @ApiBadRequestResponse({
        status: 400,
        description: 'Bad Request',
        type: BasicResponseDTO,
    })
    @ApiOperation({ operationId: 'Assign a child to a customer' })
    @UseGuards(AuthGuard('jwt'))
    @UseInterceptors(TokenRegisterInterceptor)
    @Post(':customerId/children/:childId')
    addChildToCustomer(
        @Body() body: CreateChildRowDto,
        @Param('customerId') customerId,
        @Param('childId') childId,
        @Req() request: Request,
    ) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-ignore
        const { businessID } = request.user;
        return this.customerGroupService.changeParentForChildRow({
            ...body,
            childId,
            parentId: customerId,
            businessID,
        });
    }
    /**
     * Remove a child from parent
     */
    @ApiOkResponse({
        status: 201,
        description: 'Child Removed',
        type: BasicResponseDTO,
    })
    @ApiBadRequestResponse({
        status: 400,
        description: 'Bad Request',
        type: BasicResponseDTO,
    })
    @ApiOperation({ operationId: 'Remove a child from a customer' })
    @UseGuards(AuthGuard('jwt'))
    @UseInterceptors(TokenRegisterInterceptor)
    @Delete(':customerId/children/:childId')
    removeChildFromACustomer(@Param('customerId') customerId, @Param('childId') childId, @Req() request: Request) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-ignore
        const { businessID } = request.user;
        return this.customerGroupService.removeChildRowFromParent({
            childId,
            parentId: customerId,
            businessID,
        });
    }

    /**
     * Update child relationship
     */
    @ApiOkResponse({
        status: 200,
        description: 'Child Updated',
        type: BasicResponseDTO,
    })
    @ApiBadRequestResponse({
        status: 400,
        description: 'Bad Request',
        type: BasicResponseDTO,
    })
    @ApiOperation({ operationId: 'Update a child to a customer' })
    @UseGuards(AuthGuard('jwt'))
    @UseInterceptors(TokenRegisterInterceptor)
    @Put(':customerId/children/:childId')
    updateChildRelationshipToCustomer(
        @Body() body: CreateChildRowDto,
        @Param('customerId') customerId,
        @Param('childId') childId,
        @Req() request: Request,
    ) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-ignore
        const { businessID } = request.user;
        return this.customerGroupService.changeParentForChildRow({
            ...body,
            childId,
            parentId: customerId,
            businessID,
        });
    }

    /**
     * Find one customer
     */
    @ApiOkResponse({
        status: 200,
        description: 'OK',
        type: ReadCustomerResponseDTO,
    })
    @ApiBadRequestResponse({
        status: 400,
        description: 'Bad Request',
        type: BasicResponseDTO,
    })
    @ApiNotFoundResponse(customerNotFoundResponseSchema)
    @ApiOperation({ operationId: 'Get a customer by ID' })
    @ApiParam({
        description: 'The unique identifier assigned by MeteringCo.<br><br> Example: `f8e8c18c-0a59-40f4-bf72-356090366355`',
        name: 'customerId',
        type: 'string',
        required: true,
    })
    @UseGuards(AuthGuard('jwt'))
    @UseInterceptors(TokenRegisterInterceptor)
    @Get(':customerId')
    findOne(@Param('customerId') customerId: string, @Req() request: Request) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-ignore
        const { businessID } = request.user;
        return this.customerService.findOne({ customerId, businessID });
    }

    /**
     * Create a customer
     */
    @ApiCreatedResponse({
        status: 201,
        description: 'Customer Created',
        type: CreateCustomerResponseDto,
    })
    @ApiBadRequestResponse({
        status: 400,
        description: 'Bad Request',
        type: BasicResponseDTO,
    })
    @ApiOperation({ operationId: 'Create a customer' })
    @UseGuards(AuthGuard('jwt'))
    @Post()
    create(@Body() createCustomerDto: CreateCustomerDto, @Req() request: Request) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-ignore
        const { businessID, sub } = request.user;
        return this.customerService.create({ ...createCustomerDto, businessID }, sub);
    }

    /**
     * Create Customer Refund
     * <br><br>
     * <b>NOTE:</b> This endpoint currently only supports Stripe for a refund channel. Customers with manual payments will cause an 400 error response.
     */
    @ApiCreatedResponse({
        status: 200,
        description: 'Refund Created',
        type: CreateCustomerRefundResponse,
    })
    @ApiBadRequestResponse({
        status: 400,
        description: 'Bad Request',
        type: BasicResponseDTO,
    })
    @ApiOperation({ operationId: 'Create a refund for customer' })
    @UseGuards(AuthGuard('jwt'))
    @UseInterceptors(TokenRegisterInterceptor)
    @Post(':customerId/refunds')
    createRefund(
        @Body() createCustomerRefund: CreateCustomerRefundDto,
        @Req() request: Request,
        @Param('customerId') customerId,
    ) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-ignore
        const { businessID } = request.user;

        return this.customerService.refund({ ...createCustomerRefund, businessID, customerId });
    }
    /**
     * Get a Customer Enrollment
     */
    @ApiOkResponse({
        status: 200,
        description: 'Enrollment Found',
        type: CustomerEnrollmentResponseDto,
    })
    @ApiBadRequestResponse({
        status: 400,
        description: 'Bad Request',
        type: BasicResponseDTO,
    })
    @ApiNotFoundResponse(customerNotFoundResponseSchema)
    @ApiOperation({ operationId: 'Get a Customer Enrollment' })
    @UseGuards(AuthGuard('jwt'))
    @UseInterceptors(TokenRegisterInterceptor)
    @ApiParam({
        description: 'The unique identifier assigned by MeteringCo.<br><br> Example: `f8e8c18c-0a59-40f4-bf72-356090366355`',
        name: 'customerId',
        type: 'string',
        required: true,
    })
    @Get(':customerId/enrollment')
    async getEnrollment(@Req() request: AuthorizedRequest, @Param('customerId') customerId) {
        const { businessID, sub } = request.user;
        const customerRes = await this.customerService.findOne({ businessID, customerId });
        if (customerRes?.data[0]?.offeringId) {
            const contractRes = await this.contractService.findOne({
                businessID,
                offeringId: customerRes?.data[0]?.offeringId,
                customerId,
            });
            return new CustomerEnrollmentResponseDto({
                data: [
                    {
                        offering: contractRes?.readOfferingResponseData,
                        offeringEnrollmentDate: contractRes?.offeringEnrollmentDate,
                        overrides: contractRes?.overridesForOffering,
                    },
                ],
                message: 'Found Customer Enrollment',
            });
        } else {
            return new CustomerEnrollmentResponseDto({
                data: [],
                message: 'No enrollment found for customer',
            });
        }
    }

    /**
     * Update Customer Enrollment
     */
    @ApiOkResponse({
        status: 200,
        description: 'Customer Enrollment Updated',
        type: CreateCustomerRefundResponse,
    })
    @ApiBadRequestResponse({
        status: 400,
        description: 'Bad Request',
        type: BasicResponseDTO,
    })
    @ApiNotFoundResponse(customerNotFoundResponseSchema)
    @ApiOperation({ operationId: 'Update Customer Offering Enrollment' })
    @UseGuards(AuthGuard('jwt'))
    @UseInterceptors(TokenRegisterInterceptor)
    @ApiParam({
        description: 'The unique identifier assigned by MeteringCo.<br><br> Example: `f8e8c18c-0a59-40f4-bf72-356090366355`',
        name: 'customerId',
        type: 'string',
        required: true,
    })
    @Put(':customerId/enrollment')
    async updateCustomerEnrollment(
        @Body() updateCustomerEnrollmentDto: UpdateCustomerEnrollmentDto,
        @Req() request: AuthorizedRequest,
        @Param('customerId') customerId,
    ) {
        const { businessID, sub } = request.user;
        return this.customerService.update(
            {
                offeringId: updateCustomerEnrollmentDto?.offeringId,
                businessID,
                removePriorOffering: updateCustomerEnrollmentDto?.removePriorOffering,
                unenrollOffering: updateCustomerEnrollmentDto?.unenrollOffering,
            },
            sub,
            customerId,
            updateCustomerEnrollmentDto?.overrides,
            updateCustomerEnrollmentDto?.usage,
        );
    }
    /**
     * Get customer refunds
     * <br><br>
     * <b>NOTE:</b> This endpoint currently only supports Stripe for a refund channel. Customers with manual payments will cause an 400 error response.
     */
    @ApiOkResponse({
        status: 200,
        description: 'Refunds found',
        type: FindCustomerRefundsResponse,
    })
    @ApiBadRequestResponse({
        status: 400,
        description: 'Bad Request',
        type: BasicResponseDTO,
    })
    @ApiOperation({ operationId: 'Get a refund for customer' })
    @UseGuards(AuthGuard('jwt'))
    @UseInterceptors(TokenRegisterInterceptor)
    @Get(':customerId/refunds')
    getRefund(@Req() request: Request, @Param('customerId') customerId) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-ignore
        const { businessID } = request.user;
        return this.customerService.findRefunds({ customerId, businessID });
    }

    /**
     * Get customer payments
     *  <br><br>
     * <b>NOTE:</b> This endpoint currently only supports Stripe for a payment channel. Customers with manual payments will cause an 400 error response.
     */
    @ApiOkResponse({
        status: 200,
        description: 'Payments Found',
        type: FindCustomerPaymentsResponse,
    })
    @ApiBadRequestResponse({
        status: 400,
        description: 'Bad Request',
        type: BasicResponseDTO,
    })
    @ApiOperation({ operationId: 'Get payments for customer' })
    @UseGuards(AuthGuard('jwt'))
    @UseInterceptors(TokenRegisterInterceptor)
    @Get(':customerId/payments')
    getPayments(@Req() request: Request, @Param('customerId') customerId, @Query() query: FindPaymentsQueryParamDto) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-ignore
        const { businessID } = request.user;

        return this.customerService.findPayments({ customerId, businessID, invoiceId: query?.invoiceId });
    }

    @ApiOkResponse({
        status: 200,
        description: 'Payments Found',
        type: GetCustomerStripePortalResponse,
    })
    @ApiBadRequestResponse({
        status: 400,
        description: 'Bad Request',
        type: BasicResponseDTO,
    })
    @ApiOperation({ operationId: 'Get Stripe Portal for customer' })
    @UseGuards(AuthGuard('jwt'))
    @UseInterceptors(TokenRegisterInterceptor)
    @Get(':customerId/stripePortal')
    getStripePortalUrl(@Req() request: Request, @Param('customerId') customerId) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-ignore
        const { businessID } = request.user;

        return this.customerService.getStripePortalUrl({ customerId, businessID });
    }
    /**
     *  Update a customer
     */
    @ApiOkResponse({
        status: 200,
        description: 'Customer Updated',
        type: CreateCustomerDto,
    })
    @ApiBadRequestResponse({
        status: 400,
        description: 'Bad Request',
        type: BasicResponseDTO,
    })
    @ApiNotFoundResponse(customerNotFoundResponseSchema)
    @Put(':customerId')
    @UseGuards(AuthGuard('jwt'))
    @UseInterceptors(TokenRegisterInterceptor)
    @ApiOperation({ operationId: 'Update a customer' })
    @ApiParam({
        description: 'The unique identifier assigned by MeteringCo.<br><br> Example: `f8e8c18c-0a59-40f4-bf72-356090366355`',
        name: 'customerId',
        type: 'string',
        required: true,
    })
    update(@Body() updateCustomerDto: UpdateCustomerDto, @Req() request: Request, @Param('customerId') customerId) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-ignore
        const { businessID, sub } = request.user;
        return this.customerService.update(
            { ...updateCustomerDto, businessID },
            sub,
            customerId,
            undefined,
            updateCustomerDto?.usage,
        );
    }
    /**
     *  Update a free trial of a customer
     */
    @ApiOkResponse({
        status: 200,
        description: 'Customer free trial updated',
        type: UpdateFreeTrialResponseDto,
    })
    @ApiBadRequestResponse({
        status: 400,
        description: 'Bad Request',
        type: BasicResponseDTO,
    })
    @ApiNotFoundResponse(customerNotFoundResponseSchema)
    @UseGuards(AuthGuard('jwt'))
    @UseInterceptors(TokenRegisterInterceptor)
    @Put(':customerId/freeTrial')
    @ApiOperation({ operationId: 'Update free trial' })
    @ApiParam({
        description: 'The unique identifier assigned by MeteringCo.<br><br> Example: `f8e8c18c-0a59-40f4-bf72-356090366355`',
        name: 'customerId',
        type: 'string',
        required: true,
    })
    updateFreeTrial(
        @Body() updateFreeTrialDto: UpdateFreeTrialDto,
        @Req() request: Request,
        @Param('customerId') customerId,
    ) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-ignore
        const { businessID, sub } = request.user;
        return this.customerService.updateFreeTrialEndDate({
            ...updateFreeTrialDto,
            businessID,
            customerId,
            subject: sub,
        });
    }

    /**
     * Delete a customer
     */
    @ApiOkResponse({
        status: 200,
        description: 'Customer Deleted',
        type: DeleteCustomerResponseDto,
    })
    @ApiNotFoundResponse(customerNotFoundResponseSchema)
    @UseGuards(AuthGuard('jwt'))
    @UseInterceptors(TokenRegisterInterceptor)
    @Delete(':customerId')
    @ApiParam({
        description: 'The unique identifier assigned by MeteringCo.<br><br> Example: `f8e8c18c-0a59-40f4-bf72-356090366355`',
        name: 'customerId',
        type: 'string',
        required: true,
    })
    @ApiOperation({ operationId: 'Delete a customer' })
    remove(@Param('customerId') customerId: string, @Req() request: Request) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-ignore
        const { businessID } = request.user;
        return this.customerService.remove({ customerId, businessID });
    }

    /**
     * Get usage data for a customer
     */
    @ApiOkResponse({
        status: 200,
        description: 'OK',
        type: ReadCustomerUsageData,
    })
    @ApiBadRequestResponse({
        status: 400,
        description: 'Bad Request',
        type: BasicResponseDTO,
    })
    @ApiNotFoundResponse({
        status: 404,
        description: 'Customer Not Found',
        type: NotFoundException,
    })
    @ApiOperation({ operationId: 'Get usage data for a customer' })
    @UseGuards(AuthGuard('jwt'))
    @UseInterceptors(TokenRegisterInterceptor)
    @ApiParam({
        description: 'The unique identifier assigned by MeteringCo.<br><br> Example: `f8e8c18c-0a59-40f4-bf72-356090366355`',
        name: 'customerId',
        type: 'string',
        required: true,
    })
    @Get(':customerId/usage')
    findUsage(@Param('customerId') customerId: string, @Req() request: Request, @Query() query: QueryParamUsageDto) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-ignore
        const { businessID } = request.user;

        return this.customerService.findUsageForCustomer({ businessID, customerId }, query);
    }

    /**
     * Get a token to allow SaaS customers to view their billing data in meteringco securely
     */
    @ApiOkResponse({
        status: 200,
        description: 'OK',
        type: CustomerAuthenticationTokenResponse,
    })
    @ApiNotFoundResponse(customerNotFoundResponseSchema)
    @UseGuards(AuthGuard('jwt'))
    @UseInterceptors(TokenRegisterInterceptor)
    @Get(':customerId/token')
    @ApiOperation({ operationId: 'Get a customer auth token' })
    @ApiParam({
        description: 'The unique identifier assigned by MeteringCo.<br><br> Example: `248fc14e-9934-4d3c-a39f-ce43cbb3f7b2`',
        name: 'customerId',
        type: 'string',
        required: true,
    })
    getSaaSCustomerToken(@Param('customerId') customerId: string, @Req() request: Request) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-ignore
        const { businessID } = request.user;
        return this.customerService.createSaaSCustomerToken({ customerId, businessID });
    }
}

@ApiBearerAuth('bearer')
@Controller('customers')
@ApiTags('Customers')
@ApiExtraModels(UnAggregatedUsageResponse)
@ApiExtraModels(AggregatedUsageResponse)
@ApiExtraModels(StripeRefundResponseDto)
@ApiExtraModels(StripePaymentResponseDto)
export class PrivateAPICustomerController extends PublicAPICustomerController {}
