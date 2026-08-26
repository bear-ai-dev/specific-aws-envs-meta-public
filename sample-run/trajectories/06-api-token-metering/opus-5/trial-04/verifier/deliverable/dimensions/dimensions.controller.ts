import { Controller, Get, Post, Body, Param, Delete, UseGuards, Req, Put, UseInterceptors } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { DimensionsService } from './dimensions.service.js';
import {
    CountBasedConsumptionUnit,
    CreateDimensionResponse,
    DatabasedConsumptionUnit,
    TimeBasedConsumptionUnit,
} from './dto/create-dimension.dto.js';
import { CreateDimensionDto } from './dto/create-dimension.dto.js';
import { Request } from 'express';
import {
    ApiBadRequestResponse,
    ApiBearerAuth,
    ApiConflictResponse,
    ApiCreatedResponse,
    ApiExtraModels,
    ApiNotFoundResponse,
    ApiOkResponse,
    ApiOperation,
    ApiParam,
    ApiTags,
} from '@nestjs/swagger';
import { UpdateDimensionDto } from './dto/update-dimension.dto.js';
import { ReadDimensionResponse } from './dto/read-dimension.dto.js';
import { BasicResponseDTO } from '../basicResponseDTO.js';
import { DimensionTierDto } from './dto/dimensionTier.dto.js';
import { TokenRegisterInterceptor } from '../interceptors/tokenRegisterInterceptor.js';
import { DimensionTiersGroupByMetadataDto } from './dto/dimensionTiersGroupByMetadataDto.dto.js';

@ApiExtraModels(CountBasedConsumptionUnit)
@ApiExtraModels(TimeBasedConsumptionUnit)
@ApiExtraModels(DatabasedConsumptionUnit)
@ApiExtraModels(DimensionTierDto)
@ApiExtraModels(DimensionTiersGroupByMetadataDto)
@ApiBearerAuth('bearer')
@Controller('dimensions')
@ApiTags('Dimensions')
export class PublicAPIDimensionsController {
    constructor(readonly dimensionsService: DimensionsService) {}

    /**
     * List all dimensions created in this account
     */
    @ApiOkResponse({
        status: 200,
        description: 'OK',
        type: ReadDimensionResponse,
    })
    @ApiBadRequestResponse({
        status: 400,
        description: 'Bad Request',
        type: BasicResponseDTO,
    })
    @UseGuards(AuthGuard('jwt'))
    @UseInterceptors(TokenRegisterInterceptor)
    @Get()
    @ApiOperation({ operationId: 'Get all dimensions' })
    findAll(@Req() request: Request) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-ignore
        const { businessID } = request.user;
        return this.dimensionsService.findAll({ businessID });
    }

    /**
     * Fine a dimension
     */
    @ApiOkResponse({
        status: 200,
        description: 'OK',
        type: ReadDimensionResponse,
    })
    @ApiBadRequestResponse({
        status: 400,
        description: 'Bad Request',
        type: BasicResponseDTO,
    })
    @ApiNotFoundResponse({
        status: 404,
        description: 'Dimension Not Found',
        schema: {
            type: 'object',
            properties: {
                message: {
                    type: 'string',
                    description: 'The error message',
                    example: 'No Dimensions found with ID: 22372d1d-1c0c-40e0-8167-af0b4f5c82f6',
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
                message: 'No Dimensions found with ID: 22372d1d-1c0c-40e0-8167-af0b4f5c82f6',
                error: 'Not Found',
                statusCode: 404,
            },

            required: ['message', 'error', 'statusCode'],
        },
    })
    @UseGuards(AuthGuard('jwt'))
    @UseInterceptors(TokenRegisterInterceptor)
    @Get(':dimensionId')
    @ApiOperation({ operationId: 'Get a dimension by ID' })
    @ApiParam({
        description: 'The unique identifier assigned by MeteringCo.<br><br> Example: `22372d1d-1c0c-40e0-8167-af0b4f5c82f6`',
        name: 'dimensionId',
        type: 'string',
        required: true,
    })
    findOne(@Param('dimensionId') dimensionId: string, @Req() request: Request) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-ignore
        const { businessID } = request.user;
        return this.dimensionsService.findOne({ dimensionId, businessID });
    }

    /**
     * Create a dimension
     * <br><br>
     * <a href="https://docs.meteringco.example/model-pricing-and-package/pricing-modeling-guide/single-dimension-pay-as-you-go-pricing">See an example dimension for pay as you go pricing here</a>
     */
    @ApiCreatedResponse({
        status: 201,
        description: 'OK',
        type: CreateDimensionResponse,
    })
    @ApiBadRequestResponse({
        status: 400,
        description: 'Bad Request',
        type: BasicResponseDTO,
    })
    @UseGuards(AuthGuard('jwt'))
    @Post()
    @ApiOperation({ operationId: 'Create a dimension' })
    create(@Body() createDimensionDto: CreateDimensionDto, @Req() request: Request) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-ignore
        const { businessID, sub } = request.user;
        return this.dimensionsService.create({ ...createDimensionDto, businessID }, sub);
    }

    /**
     * Update a dimension
     */
    @ApiOkResponse({
        status: 200,
        description: 'Dimension Updated',
        type: CreateDimensionResponse,
    })
    @ApiBadRequestResponse({
        status: 400,
        description: 'Bad Request',
        type: BasicResponseDTO,
    })
    @ApiNotFoundResponse({
        status: 404,
        description: 'Dimension Not Found',
        schema: {
            type: 'object',
            properties: {
                message: {
                    type: 'string',
                    description: 'The error message',
                    example: 'No Dimensions found with ID: 22372d1d-1c0c-40e0-8167-af0b4f5c82f6',
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
                message: 'No Dimensions found with ID: 22372d1d-1c0c-40e0-8167-af0b4f5c82f6',
                error: 'Not Found',
                statusCode: 404,
            },
            required: ['message', 'error', 'statusCode'],
        },
    })
    @UseGuards(AuthGuard('jwt'))
    @UseInterceptors(TokenRegisterInterceptor)
    @Put(':dimensionId')
    @ApiOperation({ operationId: 'Update a dimension' })
    @ApiParam({
        description: 'The unique identifier assigned by MeteringCo.<br><br> Example: `22372d1d-1c0c-40e0-8167-af0b4f5c82f6`',
        name: 'dimensionId',
        type: 'string',
        required: true,
    })
    update(@Body() updateOfferingDto: UpdateDimensionDto, @Req() request: Request, @Param('dimensionId') dimensionId) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-ignore
        const { businessID, sub } = request.user;
        return this.dimensionsService.update({ ...updateOfferingDto, dimensionId, businessID }, sub);
    }

    /**
     * Delete a dimension
     */
    @ApiOkResponse({
        status: 200,
        description: 'Dimension Deleted',
        type: BasicResponseDTO,
    })
    @ApiConflictResponse({
        description: "Conflict - Can't delete dimension",
        schema: {
            type: 'object',
            properties: {
                message: {
                    type: 'string',
                    required: ['true'],
                    description:
                        'An error message containing the reason why the dimension cannot be deleted.<br><br> Dimensions cannot be deleted if they are in use by active offerings.',
                    example:
                        'Cannot Delete Dimensions when they are attached to Offerings, remove dimensions from offerings before deleting. Current OfferingIds using the dimension: 693f9f08-202e-4377-b415-9767a59ce4cd',
                },
            },
        },
    })
    @ApiNotFoundResponse({
        status: 404,
        description: 'Dimension Not Found',
        schema: {
            type: 'object',
            properties: {
                message: {
                    type: 'string',
                    description: 'The error message',
                    example: 'No Dimensions found with ID: 22372d1d-1c0c-40e0-8167-af0b4f5c82f6',
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
                message: 'No Dimensions found with ID: 22372d1d-1c0c-40e0-8167-af0b4f5c82f6',
                error: 'Not Found',
                statusCode: 404,
            },
            required: ['message', 'error', 'statusCode'],
        },
    })
    @UseGuards(AuthGuard('jwt'))
    @UseInterceptors(TokenRegisterInterceptor)
    @Delete(':dimensionId')
    @ApiOperation({ operationId: 'Delete a dimension' })
    @ApiParam({
        description: 'The unique identifier assigned by MeteringCo.<br><br> Example: `22372d1d-1c0c-40e0-8167-af0b4f5c82f6`',
        name: 'dimensionId',
        type: 'string',
        required: true,
    })
    remove(@Param('dimensionId') dimensionId, @Req() request: Request) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-ignore
        const { businessID } = request.user;
        return this.dimensionsService.remove({ dimensionId, businessID });
    }
}

@Controller('dimensions')
@ApiTags('Dimensions')
export class PrivateAPIDimensionsController extends PublicAPIDimensionsController {}
