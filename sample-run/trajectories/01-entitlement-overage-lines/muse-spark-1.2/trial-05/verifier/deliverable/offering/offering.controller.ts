import { Controller, Get, Post, Body, Param, UseGuards, Req, Delete, Put, UseInterceptors } from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '@nestjs/passport';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { OfferingService } from './offering.service.js';
import { CreateOfferingDTO, CreateOfferingResponse, UpdateOfferingResponse } from './dto/createOffering.dto.js';
import {
    ApiBadRequestResponse,
    ApiBearerAuth,
    ApiConflictResponse,
    ApiCreatedResponse,
    ApiNotFoundResponse,
    ApiOkResponse,
    ApiOperation,
    ApiParam,
    ApiTags,
} from '@nestjs/swagger';
import { ReadOfferingResponseDTO } from './dto/readOffering.dto.js';
import { BasicResponseDTO } from '../basicResponseDTO.js';
import { UpdateOfferingDto } from './dto/updateOfferingDto.js';
import { DeleteOfferingResponse } from './dto/deleteOffering.dto.js';
import { AuthorizedRequest } from '../authz/jwt-local.gaurd.js';
import { TokenRegisterInterceptor } from '../interceptors/tokenRegisterInterceptor.js';

/**
 *
 * This is the offering section
 */
@ApiBearerAuth('bearer')
@Controller('offerings')
@ApiTags('Offerings')
export class PublicAPIOfferingController {
    constructor(readonly OfferingService: OfferingService) {}

    /**
     * List all offerings created in this account
     */
    @ApiOkResponse({
        status: 200,
        description: 'OK',
        type: ReadOfferingResponseDTO,
    })
    @ApiBadRequestResponse({
        status: 400,
        description: 'Bad Request',
        type: BasicResponseDTO,
    })
    @ApiOperation({ operationId: 'Get all Offerings' })
    @UseGuards(AuthGuard('jwt'))
    @UseInterceptors(TokenRegisterInterceptor)
    @Get()
    findAll(@Req() request: AuthorizedRequest) {
        const { businessID } = request.user;
        return this.OfferingService.findAll({ businessID });
    }

    /**
     * Find an offering
     */
    @ApiOkResponse({
        status: 200,
        description: 'OK',
        type: ReadOfferingResponseDTO,
    })
    @ApiBadRequestResponse({
        status: 400,
        description: 'Bad Request',
        type: BasicResponseDTO,
    })
    @ApiNotFoundResponse({
        status: 404,
        description: 'Offering Not Found',
        schema: {
            type: 'object',
            properties: {
                message: {
                    type: 'string',
                    description: 'The error message',
                    example: 'Offering with ID: 807867e0-26ca-4831-846b-a670224db055 not found',
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
                message: 'Offering with ID: 807867e0-26ca-4831-846b-a670224db055 not found',
                error: 'Not Found',
                statusCode: 404,
            },
            required: ['message', 'error', 'statusCode'],
        },
    })
    @UseGuards(AuthGuard('jwt'))
    @UseInterceptors(TokenRegisterInterceptor)
    @Get(':offeringId')
    @ApiOperation({ operationId: 'Get an offering by ID' })
    @ApiParam({
        description: 'The unique identifier assigned by MeteringCo.<br><br> Example: `22372d1d-1c0c-40e0-8167-af0b4f5c82f6`',
        name: 'offeringId',
        type: 'string',
        required: true,
    })
    findOne(@Param('offeringId') offeringId: string, @Req() request: AuthorizedRequest) {
        const { businessID } = request.user;
        return this.OfferingService.findOne({ businessID, offeringId });
    }

    /**
     * Create an offering
     */
    @ApiCreatedResponse({
        status: 201,
        description: 'Offering Created',
        type: CreateOfferingResponse,
    })
    @ApiBadRequestResponse({
        status: 400,
        description: 'Bad Request',
        type: BasicResponseDTO,
    })
    @UseGuards(AuthGuard('jwt'))
    @Post()
    @ApiOperation({ operationId: 'Create an offering' })
    create(@Body() createOfferingDto: CreateOfferingDTO, @Req() request: AuthorizedRequest) {
        const { businessID, sub } = request.user;
        return this.OfferingService.create({ ...createOfferingDto, businessID }, sub);
    }

    /**
     * Update an offering
     */
    @ApiOkResponse({
        status: 200,
        description: 'Offering Updated',
        type: UpdateOfferingResponse,
    })
    @ApiBadRequestResponse({
        status: 400,
        description: 'Bad Request',
        type: BasicResponseDTO,
    })
    @ApiNotFoundResponse({
        status: 404,
        description: 'Offering Not Found',
        schema: {
            type: 'object',
            properties: {
                message: {
                    type: 'string',
                    description: 'The error message',
                    example: 'Offering with ID: 807867e0-26ca-4831-846b-a670224db055 not found',
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
                message: 'Offering with ID: 807867e0-26ca-4831-846b-a670224db055 not found',
                error: 'Not Found',
                statusCode: 404,
            },
            required: ['message', 'error', 'statusCode'],
        },
    })
    @UseGuards(AuthGuard('jwt'))
    @UseInterceptors(TokenRegisterInterceptor)
    @Put(':offeringId')
    @ApiOperation({ operationId: 'Update an offering' })
    @ApiParam({
        description: 'The unique identifier assigned by MeteringCo.<br><br> Example: `22372d1d-1c0c-40e0-8167-af0b4f5c82f6`',
        name: 'offeringId',
        type: 'string',
        required: true,
    })
    update(
        @Body() updateOfferingDto: UpdateOfferingDto,
        @Req() request: AuthorizedRequest,
        @Param('offeringId') offeringId: string,
    ) {
        const { businessID } = request.user;
        return this.OfferingService.update({ ...updateOfferingDto, offeringId, businessID });
    }

    /**
     * Delete an offering
     */
    @ApiOkResponse({
        status: 200,
        description: 'Offering Deleted',
        type: DeleteOfferingResponse,
    })
    @ApiNotFoundResponse({
        status: 404,
        description: 'Offering Not Found',
        schema: {
            type: 'object',
            properties: {
                message: {
                    type: 'string',
                    description: 'The error message',
                    example: 'Offering with ID: 807867e0-26ca-4831-846b-a670224db055 not found',
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
                message: 'Offering with ID: 807867e0-26ca-4831-846b-a670224db055 not found',
                error: 'Not Found',
                statusCode: 404,
            },
            required: ['message', 'error', 'statusCode'],
        },
    })
    @ApiConflictResponse({
        description: "Conflict - Can't delete Offering",
        schema: {
            type: 'object',
            properties: {
                message: {
                    type: 'string',
                    description:
                        'An error message containing the reason why the offering cannot be deleted.<br><br> Offerings cannot be deleted if they are in use by active customers.',
                    example:
                        'Cannot delete offering when they are attached to customers, remove customers from offerings before deleting. Current customerIds using the offering:: 80ddb121-e3d2-4d28-891d-704532c6649d',
                },
            },
        },
    })
    @UseGuards(AuthGuard('jwt'))
    @UseInterceptors(TokenRegisterInterceptor)
    @Delete(':offeringId')
    @ApiOperation({ operationId: 'Delete an offering' })
    @ApiParam({
        description: 'The unique identifier assigned by MeteringCo.<br><br> Example: `22372d1d-1c0c-40e0-8167-af0b4f5c82f6`',
        name: 'offeringId',
        type: 'string',
        required: true,
    })
    delete(@Param('offeringId') offeringId, @Req() request: AuthorizedRequest) {
        const { businessID } = request.user;
        return this.OfferingService.delete({ offeringId, businessID });
    }
}
@ApiBearerAuth('bearer')
@Controller('offerings')
@ApiTags('Offerings')
export class PrivateAPIOfferingController extends PublicAPIOfferingController {}
