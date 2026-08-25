import { Controller, Get, Body, UseGuards, Param, Req, NotFoundException, Post } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
    ApiBadRequestResponse,
    ApiCreatedResponse,
    ApiNotFoundResponse,
    ApiOkResponse,
    ApiOperation,
    ApiParam,
    ApiTags,
} from '@nestjs/swagger';
import { BasicResponseDTO } from '../basicResponseDTO.js';
import { CreditService } from './credit.service.js';
import { CreateCreditDto } from './dto/create-credit.dto.js';
import { Request } from 'express';
import { CreditLedgerResponse } from './dto/readCreditBalance.dto.js';
import { AuditService } from '../audit/audit.service.js';
import { AuditScope } from '../audit/entities/audit.interface.js';

@ApiTags('Customers')
@Controller('customers')
export class CreditController {
    constructor(private readonly creditService: CreditService) {}

    /**
     * Commit a transaction to the ledger for a customer. This will update thier credit balances
     */
    @ApiCreatedResponse({
        status: 201,
        description: 'OK',
        type: BasicResponseDTO,
    })
    @UseGuards(AuthGuard('jwt'))
    @ApiOperation({ operationId: 'Create a wallet transaction' })
    @Post(':customerId/transactions')
    async create(
        @Body() createCreditDto: CreateCreditDto,
        @Req() request: Request,
        @Param('customerId') customerId: string,
    ) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-ignore
        const { businessID } = request.user;
        const validateCustomer = true;

        const res = await this.creditService.create({ ...createCreditDto, customerId, businessID }, validateCustomer);
        if (res?.message) {
            return { message: res?.message };
        } else {
            AuditService.publishEvent({
                message: 'No response from credit service',
                data: [{ ...createCreditDto, customerId, businessID, res }],
                topic: AuditScope.ERROR,
            });
            return { message: 'No response from credit service, Check Credit Ledger' };
        }
    }
    /**
     * Get the ledger of wallet transactions applied to a customer
     */
    @ApiOkResponse({
        status: 200,
        description: 'OK',
        type: CreditLedgerResponse,
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
    @ApiOperation({ operationId: 'Get customer credit ledger' })
    @UseGuards(AuthGuard('jwt'))
    @ApiParam({
        description: 'The unique identifier assigned by MeteringCo.<br><br> Example: `f8e8c18c-0a59-40f4-bf72-356090366355`',
        name: 'customerId',
        type: 'string',
        required: true,
    })
    @Get(':customerId/transactions')
    findUsage(@Param('customerId') customerId: string, @Req() request: Request) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-ignore
        const { businessID } = request.user;
        const validateCustomer = true;
        return this.creditService.getCreditLedger({ businessID, customerId }, validateCustomer);
    }
}
