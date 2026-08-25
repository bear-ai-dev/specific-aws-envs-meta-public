import { Body, Controller, Get, Param, Post, Put, Query, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
    ApiBadRequestResponse,
    ApiBearerAuth,
    ApiExtraModels,
    ApiNotFoundResponse,
    ApiOkResponse,
    ApiOperation,
    ApiParam,
    ApiQuery,
    ApiTags,
} from '@nestjs/swagger';
import { CreateInvoicesDto } from './dto/create-Invoices.dto.js';
import { InvoicesService } from './invoices.service.js';
import { UpdateInvoicesDto } from './dto/update-invoices.dto.js';
import { Request } from 'express';
import { ReadInvoicesResponse } from './dto/read-invoices.dto.js';
import { BasicResponseDTO } from '../basicResponseDTO.js';
import { InvoiceLineItem } from './entities/invoice.entity.js';
import { TokenRegisterInterceptor } from '../interceptors/tokenRegisterInterceptor.js';

@ApiBearerAuth('bearer')
@Controller('invoices')
@ApiTags('Invoices')
@ApiExtraModels(InvoiceLineItem)
export class PublicAPIInvoicesController {
    constructor(readonly invoiceService: InvoicesService) {}
    /**
     * Find an Invoice
     * <br><br> Download links for invoices are valid for 7 days.
     */
    @ApiOkResponse({
        status: 200,
        description: 'OK',
        type: ReadInvoicesResponse,
    })
    @ApiBadRequestResponse({
        status: 400,
        description: 'Bad Request',
        type: BasicResponseDTO,
    })
    @ApiNotFoundResponse({
        status: 404,
        description: 'Invoice Not Found',
        schema: {
            type: 'object',
            properties: {
                message: {
                    type: 'string',
                    description: 'The error message',
                    example: 'Invoice with ID: 7c71590b-3368-4d53-b9cb-5203605b4946 not found',
                },
                error: {
                    type: 'string',
                    description: 'The error name',
                    example: 'Not Found',
                },
                statusCode: {
                    type: 'number',
                    description: 'The HTTP status code',
                    example: 404,
                    externalDocs: {
                        description: 'MDN Documentation Reference',
                        url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/404',
                    },
                },
            },
            example: {
                message: 'Invoice with ID: 7c71590b-3368-4d53-b9cb-5203605b4946 not found',
                error: 'Not Found',
                statusCode: 404,
            },
            required: ['message', 'error', 'statusCode'],
        },
    })
    @ApiOperation({
        operationId: 'Get an Invoice by ID',
    })
    @ApiParam({
        type: 'string',
        name: 'invoiceId',
        description: 'The invoice ID assigned by MeteringCo',
        example: '7c71590b-3368-4d53-b9cb-5203605b4946',
    })
    @ApiQuery({
        type: 'string',
        name: 'download',
        description: 'Get a download link for the invoice in the response',
        example: 'true',
        required: false,
    })
    @UseGuards(AuthGuard('jwt'))
    @UseInterceptors(TokenRegisterInterceptor)
    @Get(':invoiceId')
    getOne(@Req() request: Request, @Param('invoiceId') invoiceId: string, @Query('download') download = 'false') {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-ignore
        const { businessID } = request.user;
        return this.invoiceService.findOne(businessID, invoiceId, download);
    }
    @ApiOperation({ operationId: 'Create' })
    @UseGuards(AuthGuard('jwt'))
    @Post()
    async create(@Body() createInvoiceDto: CreateInvoicesDto, @Req() request: Request) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-ignore
        const { businessID } = request.user;
        const isManual = true;
        if (createInvoiceDto?.items) {
            return this.invoiceService.create({ businessID, ...createInvoiceDto }, isManual);
        }
        if (createInvoiceDto?.start || createInvoiceDto?.end) {
            return this.invoiceService.generateInvoiceForUsageTotal({ businessID, ...createInvoiceDto }, isManual);
        }
    }
}
@ApiBearerAuth('bearer')
@Controller('invoices')
@ApiTags('Invoices')
export class PrivateInvoicesController extends PublicAPIInvoicesController {
    @ApiOperation({ operationId: 'Update' })
    @UseGuards(AuthGuard('jwt'))
    @Put(':invoiceId')
    update(
        @Body() updateInvoicesDto: UpdateInvoicesDto,
        @Req() request: Request,
        @Param('invoiceId') invoiceId: string,
    ) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-ignore
        const { businessID } = request.user;
        return this.invoiceService.update({ ...updateInvoicesDto, businessID, invoiceId });
    }
}
